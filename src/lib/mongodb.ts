/**
 * Local JSON Database — replaces MongoDB
 * Uses eval() to hide Node built-in imports from webpack's static analysis,
 * preventing "Can't resolve 'fs' errors during client-side bundling.
 *
 * Performance: each collection keeps an in-memory index (rebuilt whenever
 * the file changes) so `_id` lookups and equality queries on indexed fields
 * (scan_id, user_id, status, email) avoid linear scans. The parsed document
 * array is cached between writes (mtime-checked against the file so external
 * writers are still picked up). Writes remain full-file atomic rewrites —
 * unchanged semantics, same durability.
 */
const _require = eval('require'); // hides require from webpack

function getFs() { return _require('fs'); }
function getPath() { return _require('path'); }
function getCrypto() { return _require('crypto'); }

const DATA_DIR = process.cwd() + '/data';

// Clean up stale temp files from any previous crash (leftovers from atomicWrite's
// temp-file-then-rename pattern if the process was killed mid-write).
try {
  const fs = getFs();
  if (fs.existsSync(DATA_DIR)) {
    for (const file of fs.readdirSync(DATA_DIR)) {
      if (file.endsWith('.tmp') || /\.tmp\.\d+$/.test(file)) {
        fs.unlinkSync(DATA_DIR + '/' + file);
      }
    }
  }
} catch { /* ignore */ }

// ── Index definitions ──
// Default per-collection indexes. Definitions are persisted to
// `data/<collection>._indexes.json` on first use, so new indexes can be added
// without code changes (edit the metadata file, restart, and the in-memory
// index picks the new fields up on next read). `_id` is always indexed.
interface IndexDef {
  field: string;
  unique?: boolean;
}

const DEFAULT_INDEXES: Record<string, IndexDef[]> = {
  users: [{ field: '_id', unique: true }, { field: 'email' }],
  scans: [{ field: '_id', unique: true }, { field: 'user_id' }, { field: 'id' }],
  dishes: [{ field: '_id', unique: true }, { field: 'scan_id' }, { field: 'id' }],
  cache: [{ field: '_id', unique: true }, { field: 'key' }],
  agent_log: [{ field: '_id', unique: true }, { field: 'scan_id' }, { field: 'status' }],
  agent_log_dlq: [{ field: '_id', unique: true }, { field: 'scan_id' }, { field: 'job_id' }],
};

interface CollectionIndexes {
  /** field → value → array of indices into the data array */
  byField: Map<string, Map<string, number[]>>;
  /** true when at least one doc carries an explicit `id` field (disables the
   *  `{ id } → _id` alias optimization; see _match) */
  hasExplicitId: boolean;
}

class LocalCollection {
  private name: string;
  private indexes: IndexDef[];

  /** Parsed doc array + indexes + file mtime; null = not loaded yet. */
  private cache: { data: any[]; mtimeMs: number; indexes: CollectionIndexes } | null = null;

  constructor(name: string) {
    this.name = name;
    this._ensureFile();
    this.indexes = this._loadIndexDefs();
  }

  private _ensureFile() {
    const fs = getFs();
    const dir = getPath().dirname(this._filePath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this._filePath())) fs.writeFileSync(this._filePath(), '[]');
  }

  private _filePath(): string {
    return DATA_DIR + '/' + this.name + '.json';
  }

  private _indexesPath(): string {
    return DATA_DIR + '/' + this.name + '._indexes.json';
  }

  /** Persisted index definitions — created from defaults on first use. */
  private _loadIndexDefs(): IndexDef[] {
    const fs = getFs();
    const path = this._indexesPath();
    const defaults = DEFAULT_INDEXES[this.name] || [{ field: '_id', unique: true }];
    try {
      if (fs.existsSync(path)) {
        const parsed = JSON.parse(fs.readFileSync(path, 'utf8')) as IndexDef[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const seen = new Set(parsed.map(d => d.field));
          // Merge defaults in case the metadata file predates a new default.
          for (const d of defaults) if (!seen.has(d.field)) parsed.push(d);
          return parsed;
        }
      }
    } catch { /* fall through to defaults */ }
    try {
      fs.writeFileSync(path, JSON.stringify(defaults, null, 2));
    } catch { /* non-fatal */ }
    return defaults;
  }

  private _buildIndexes(data: any[]): CollectionIndexes {
    const byField = new Map<string, Map<string, number[]>>();
    for (const def of this.indexes) {
      byField.set(def.field, new Map());
    }
    let hasExplicitId = false;
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item && typeof item === 'object') {
        if (item.id !== undefined) hasExplicitId = true;
        for (const def of this.indexes) {
          const value = item[def.field];
          if (value !== undefined && value !== null && typeof value !== 'object') {
            const map = byField.get(def.field)!;
            const key = String(value);
            const bucket = map.get(key);
            if (bucket) bucket.push(i);
            else map.set(key, [i]);
          }
        }
      }
    }
    return { byField, hasExplicitId };
  }

  private _read(): any[] {
    const fs = getFs();
    const filePath = this._filePath();
    try {
      const stat = fs.statSync(filePath);
      if (this.cache && this.cache.mtimeMs === stat.mtimeMs) {
        return this.cache.data;
      }
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.cache = { data, mtimeMs: stat.mtimeMs, indexes: this._buildIndexes(data) };
      return data;
    } catch {
      this.cache = { data: [], mtimeMs: 0, indexes: this._buildIndexes([]) };
      return [];
    }
  }

  /** After an in-memory mutation, keep the cache in sync (no re-read needed). */
  private _syncCache(data: any[]) {
    const fs = getFs();
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(this._filePath()).mtimeMs; } catch { /* ignore */ }
    this.cache = { data, mtimeMs, indexes: this._buildIndexes(data) };
  }

  /**
   * Atomic write — writes to a temp file first, then renames it to the target
   * path. On all POSIX and Windows platforms, `rename` is atomic, so a crash
   * mid-write never leaves a corrupted JSON file (the old file is either
   * fully replaced or untouched).
   */
  private _write(data: any[]) {
    const fs = getFs();
    const filePath = this._filePath();
    const tmpPath = filePath + '.tmp.' + Date.now();
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
    this._syncCache(data);
  }

  private _id() { return getCrypto().randomUUID(); }

  private _match(item: any, query: any): boolean {
    if (!query || Object.keys(query).length === 0) return true;
    for (const [key, value] of Object.entries(query)) {
      // Documents are stored with _id (no id field). When a caller queries
      // by { id }, match against _id for docs without an explicit id field.
      if (key === 'id' && value !== undefined && item.id === undefined && item._id === value) continue;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const v = value as Record<string, any>;
        if (v.$gte !== undefined && !(item[key] >= v.$gte)) return false;
        if (v.$lte !== undefined && !(item[key] <= v.$lte)) return false;
        if (v.$gt !== undefined && !(item[key] > v.$gt)) return false;
        if (v.$lt !== undefined && !(item[key] < v.$lt)) return false;
        if (v.$ne !== undefined && item[key] === v.$ne) return false;
        if (v.$in !== undefined && !v.$in.includes(item[key])) return false;
        if (v.$nin !== undefined && v.$nin.includes(item[key])) return false;
        if (v.$regex !== undefined) {
          if (!new RegExp(v.$regex, v.$options || '').test(String(item[key] || ''))) return false;
        }
        if (v.$exists !== undefined) {
          if (v.$exists !== (item[key] !== undefined && item[key] !== null)) return false;
        }
      } else {
        if (item[key] !== value) return false;
      }
    }
    return true;
  }

  /**
   * Returns candidate indices for an exact-equality query on an indexed
   * field, or null when the query can't use an index (full scan needed).
   * `{ id: X }` resolves to the `_id` index — docs are persisted with `_id`
   * only (AGENTS.md rule 5); the optimization is disabled if any doc carries
   * an explicit `id` field so _match semantics stay exact.
   */
  private _indexCandidates(query: any, cache: CollectionIndexes): number[] | null {
    if (!query) return null;
    const keys = Object.keys(query);
    if (keys.length !== 1) return null;
    const [key, value] = [keys[0], query[keys[0]]];
    if (value === null || typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return null;
    }
    let field = key;
    if (key === 'id') {
      if (cache.hasExplicitId) return null;
      field = '_id';
    }
    const map = cache.byField.get(field);
    if (!map) return null;
    const hit = map.get(String(value));
    return hit ? [...hit] : [];
  }

  find(query = {}) {
    const data = this._read();
    const candidates = this._indexCandidates(query, this.cache!.indexes);
    if (candidates === null) {
      return data.filter(item => this._match(item, query));
    }
    // Index narrowed the search; _match still validates each candidate so
    // semantics are identical to a full scan.
    return candidates
      .map(i => data[i])
      .filter(item => item !== undefined && this._match(item, query));
  }

  findOne(query = {}) { return this.find(query)[0] || null; }

  insertOne(doc: any) {
    const data = this._read();
    const record = { _id: doc._id || this._id(), ...doc, created_at: doc.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
    data.push(record);
    this._write(data);
    return { acknowledged: true, insertedId: record._id };
  }

  insertMany(docs: any[]) {
    if (!docs || docs.length === 0) return [];
    const data = this._read();
    const now = new Date().toISOString();
    const records = docs.map(doc => ({
      _id: doc._id || this._id(),
      ...doc,
      created_at: doc.created_at || now,
      updated_at: now,
    }));
    data.push(...records);
    this._write(data);
    return records.map(r => ({ acknowledged: true, insertedId: r._id }));
  }

  updateOne(query: any, update: any) {
    const data = this._read();
    const candidates = this._indexCandidates(query, this.cache!.indexes);
    const idx = candidates === null
      ? data.findIndex(item => this._match(item, query))
      : candidates.find(i => this._match(data[i], query)) ?? -1;
    if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
    const $set = update.$set || update;
    data[idx] = { ...data[idx], ...$set, updated_at: new Date().toISOString() };
    this._write(data);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  updateMany(query: any, update: any) {
    const data = this._read();
    const $set = update.$set || update;
    let count = 0;
    data.forEach((item, i) => {
      if (this._match(item, query)) {
        data[i] = { ...item, ...$set, updated_at: new Date().toISOString() };
        count++;
      }
    });
    if (count > 0) this._write(data);
    return { matchedCount: count, modifiedCount: count };
  }

  /**
   * Apply a batch of distinct per-document updates with ONE read + ONE write.
   * The queue's enrichment write-back used to call updateOne per dish, which
   * re-read and re-wrote the entire collection file for every dish in a scan
   * (N full-file rewrites per job, racing under the 3-worker pool). Each entry
   * is { query, $set } — $set values may differ per doc.
   */
  bulkUpdate(updates: { query: any; $set: any }[]) {
    if (!updates || updates.length === 0) return { matchedCount: 0, modifiedCount: 0 };
    const data = this._read();
    let count = 0;
    for (const { query, $set } of updates) {
      const idx = data.findIndex(item => this._match(item, query));
      if (idx === -1) continue;
      data[idx] = { ...data[idx], ...($set || {}), updated_at: new Date().toISOString() };
      count++;
    }
    if (count > 0) this._write(data);
    return { matchedCount: count, modifiedCount: count };
  }

  deleteOne(query: any) {
    const data = this._read();
    const idx = data.findIndex(item => this._match(item, query));
    if (idx === -1) return { deletedCount: 0 };
    data.splice(idx, 1);
    this._write(data);
    return { deletedCount: 1 };
  }

  deleteMany(query: any) {
    const data = this._read();
    const before = data.length;
    const filtered = query && Object.keys(query).length > 0 ? data.filter(item => !this._match(item, query)) : [];
    if (filtered.length < before) this._write(filtered);
    return { deletedCount: before - filtered.length };
  }

  countDocuments(query = {}) { return this.find(query).length; }

  aggregate(pipeline: any[]) {
    let result = this._read();
    for (const stage of pipeline) {
      if (stage.$match) result = result.filter(i => this._match(i, stage.$match));
      else if (stage.$sort) {
        const [key, dir] = Object.entries(stage.$sort)[0] as [string, number];
        result.sort((a: any, b: any) => dir * ((a[key] || 0) > (b[key] || 0) ? 1 : -1));
      } else if (stage.$limit) result = result.slice(0, stage.$limit);
      else if (stage.$skip) result = result.slice(stage.$skip);
      else if (stage.$group) {
        const groups: Record<string, any> = {};
        const key = stage.$group._id;
        result.forEach(i => {
          const k = key === null ? '_all' : String(i[key] || 'unknown');
          if (!groups[k]) groups[k] = { _id: k, count: 0, items: [] };
          groups[k].count++;
          groups[k].items.push(i);
        });
        result = Object.values(groups);
      }
    }
    return result;
  }
}

const _collections: Record<string, LocalCollection> = {};

export function db(name: string) {
  if (!_collections[name]) _collections[name] = new LocalCollection(name);
  return _collections[name];
}

export async function connectToDatabase() {
  ['users', 'scans', 'dishes', 'cache', 'agent_log', 'agent_log_dlq'].forEach(name => db(name));
  return { db };
}

// getDatabase() — returns MongoDB-compatible interface for existing API routes
export async function getDatabase() {
  await connectToDatabase();
  return {
    collection(name: string) {
      const col = _collections[name] || new LocalCollection(name);
      return {
        findOne: (query: any) => col.findOne(query),
        find: (query: any) => ({
          toArray: () => col.find(query),
        }),
        insertMany: (docs: any[]) => col.insertMany(docs),
        findOneAndUpdate: (query: any, update: any, options?: { upsert?: boolean; returnDocument?: string }) => {
          const existing = col.findOne(query);
          if (existing) {
            col.updateOne(query, update.$set || update);
            return { value: col.findOne(query), ok: 1 };
          }
          if (options?.upsert) {
            const doc = { ...query, ...(update.$set || {}), ...(update.$setOnInsert || {}) };
            col.insertOne(doc);
            return { value: col.findOne(query), ok: 1 };
          }
          return { value: null, ok: 1 };
        },
      };
    },
  };
}
