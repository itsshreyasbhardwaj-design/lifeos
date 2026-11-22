import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, withTx } from '../src/db.ts';

test('migrations apply on embedded PostgreSQL and are idempotent', async () => {
  const db = await connect({ url: 'memory://' });
  const rows = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
  assert.ok(rows[0]!.n > 40, `expected >40 tables, got ${rows[0]!.n}`);
  const { migrate } = await import('../src/db.ts');
  assert.deepEqual(await migrate(db), []);
  await db.close();
});

test('withTx rolls back on error and nests without deadlock', async () => {
  const db = await connect({ url: 'memory://', migrate: false });
  await db.query('CREATE TABLE t (v int)');
  await assert.rejects(
    withTx(db, async (q) => {
      await q.query('INSERT INTO t VALUES (1)');
      await withTx(q, async (inner) => inner.query('INSERT INTO t VALUES (2)'));
      throw new Error('boom');
    }),
  );
  assert.deepEqual(await db.query('SELECT * FROM t'), []);
  await db.close();
});
