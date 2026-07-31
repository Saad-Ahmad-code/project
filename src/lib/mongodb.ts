/**
 * Local JSON Database — replaces MongoDB
 * Uses eval() to hide Node built-in imports from webpack's static analysis,
 * preventing "Can't resolve 'fs'" errors during client-side bundling.
 */

const _require = eval('require'); // hides require from webpack

function getFs() { return _require('fs'); }
function getPath() { return _require('path'); }
function getCrypto() { return _require('crypto'); }

const DATA_DIR = process.cwd() + '/data';

class LocalCollection {
  private name: string;

  constructor(name: string) {
    this.name = name;
    this._ensureFile();
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

  private _read(): any[] {
    try {
      const content = getFs().readFileSync(this._filePath(), 'utf8');
      return JSON.parse(content);
    } catch { return []; }
  }

  private _write(data: any[]) {
    getFs().writeFileSync(this._filePath(), JSON.stringify(data, null, 2));
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

  find(query = {}) { return this._read().filter(item => this._match(item, query)); }
  findOne(query = {}) { return this.find(query)[0] || null; }

  insertOne(doc: any) {
    const data = this._read();
    const record = { _id: doc._id || this._id(), ...doc, created_at: doc.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
    data.push(record);
    this._write(data);
    return { acknowledged: true, insertedId: record._id };
  }

  insertMany(docs: any[]) { return docs.map(d => this.insertOne(d)); }

  updateOne(query: any, update: any) {
    const data = this._read();
    const idx = data.findIndex(item => this._match(item, query));
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
  ['users', 'scans', 'dishes', 'cache', 'rate_limits', 'agent_log'].forEach(name => db(name));
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
