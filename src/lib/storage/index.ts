/**
 * Storage layer — wraps local JSON database
 * Exports `db` object with methods expected by existing API routes.
 * Generic defaults are `Document` (see src/lib/db-types.ts); pass an
 * explicit type like `db.findById<ScanDoc>(...)` for full typing.
 */
import { db as _db } from '../mongodb';
import type { Document } from '../db-types';

// API-compatible wrapper for existing route files
export const db = {
  findById<T = Document>(collection: string, id: string): T | null {
    return _db(collection).findOne({ id }) as T | null;
  },
  findBy<T = Document>(collection: string, query: Record<string, unknown>): T[] {
    return _db(collection).find(query) as T[];
  },
  findAll<T = Document>(collection: string, limit = 50): T[] {
    return _db(collection).find().slice(0, limit) as T[];
  },
  count(collection: string, query?: Record<string, unknown>): number {
    if (query) return _db(collection).find(query).length;
    return _db(collection).countDocuments();
  },
  create<T = Document>(collection: string, doc: Partial<T>): { _id: string } {
    const result = _db(collection).insertOne(doc);
    return { _id: result.insertedId };
  },
  update<T = Document>(collection: string, id: string, updates: Partial<T>): { matched: boolean; data: T | null } {
    const result = _db(collection).updateOne({ id }, { $set: updates });
    if (result.matchedCount === 0) return { matched: false, data: null };
    const data = _db(collection).findOne({ id }) as T | null;
    return { matched: true, data };
  },
  /** Apply many per-doc updates with a single read/write — see LocalCollection.bulkUpdate. */
  bulkUpdate<T = Document>(collection: string, updates: { query: Record<string, unknown>; $set: Partial<T> }[]): { matched: number } {
    const result = _db(collection).bulkUpdate(updates);
    return { matched: result.matchedCount };
  },
  deleteOne(collection: string, query: Record<string, unknown>) {
    return _db(collection).deleteOne(query);
  }
};

export class LocalStorage {
  saveScan(userId: string, imagePath: string, rawText: string, dishes: any[]) {
    return _db('scans').insertOne({
      user_id: userId,
      image_path: imagePath,
      raw_text: rawText,
      items_count: dishes.length,
      dishes,
      status: 'completed'
    });
  }

  getScan(id: string) {
    return _db('scans').findOne({ id });
  }

  getUserScans(userId: string, limit = 50) {
    return _db('scans')
      .find({ user_id: userId })
      .sort((a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, limit);
  }

  getStats() {
    return {
      total_scans: _db('scans').countDocuments(),
      total_users: _db('users').countDocuments(),
      total_dishes: _db('dishes').countDocuments()
    };
  }
}

export const storage = new LocalStorage();
