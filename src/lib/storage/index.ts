/**
 * Storage layer — wraps local JSON database
 * Exports `db` object with methods expected by existing API routes
 */
import { db as _db } from '../mongodb';

// API-compatible wrapper for existing route files
export const db = {
  findById<T = any>(collection: string, id: string): T | null {
    return _db(collection).findOne({ id }) as T | null;
  },
  findBy<T = any>(collection: string, query: any): T[] {
    return _db(collection).find(query) as T[];
  },
  findAll<T = any>(collection: string, limit = 50): T[] {
    return _db(collection).find().slice(0, limit) as T[];
  },
  count(collection: string, query?: any): number {
    if (query) return _db(collection).find(query).length;
    return _db(collection).countDocuments();
  },
  create<T = any>(collection: string, doc: any): T {
    const result = _db(collection).insertOne(doc);
    return { ...doc, id: result.insertedId } as T;
  },
  update<T = any>(collection: string, id: string, updates: any): T | null {
    _db(collection).updateOne({ id }, { $set: updates });
    return _db(collection).findOne({ id }) as T | null;
  },
  deleteOne(collection: string, query: any) {
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
