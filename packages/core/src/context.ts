import type { Db, Queryable } from './db.ts';

/** Everything a service call needs: the database, who is acting, and "now". */
export interface Ctx {
  db: Db;
  userId: string;
  now: Date;
}

export type Q = Queryable | Db;

export function ctxFor(db: Db, userId: string, now = new Date()): Ctx {
  return { db, userId, now };
}
