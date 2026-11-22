import { connect } from '@lifeos/core/db';
export async function count() {
  const db = await connect();
  const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
  return r[0]!.n;
}
