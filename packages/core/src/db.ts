/**
 * PostgreSQL access.
 *
 * One small interface, two drivers:
 *   - PGlite: real PostgreSQL 17 compiled to WASM, in-process. Default for local
 *     development, tests and single-node self-hosting. No server to install.
 *   - pg: a regular PostgreSQL server over the wire, for production.
 *
 * The same SQL and the same migrations run on both, because both are Postgres.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a multi-statement script without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly kind: 'pglite' | 'postgres';
  /** Runs fn inside a transaction. Use `withTx` to compose services. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** `memory://`, a directory path for PGlite, or a postgres:// URL. */
  url?: string;
  migrate?: boolean;
}

export async function connect(options: ConnectOptions = {}): Promise<Db> {
  const url = options.url ?? process.env.DATABASE_URL ?? defaultDataDir();
  const db = /^postgres(ql)?:\/\//.test(url) ? await connectPostgres(url) : await connectPglite(url);
  if (options.migrate !== false) await migrate(db);
  return db;
}

export function defaultDataDir(): string {
  return join(repoRoot(), 'data', 'pglite');
}

export function repoRoot(): string {
  if (process.env.LIFEOS_ROOT) return process.env.LIFEOS_ROOT;
  // packages/core/src/db.ts → repository root. Bundled server code has no stable
  // file location, so the web app sets LIFEOS_ROOT explicitly in next.config.
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

async function connectPglite(url: string): Promise<Db> {
  // The specifier is kept out of reach of bundlers: PGlite locates its WASM and
  // data files relative to its own module URL, which bundling would break.
  const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '@electric-sql/pglite')) as typeof import('@electric-sql/pglite');
  const dataDir = url === 'memory://' ? undefined : url.replace(/^file:\/\//, '');
  if (dataDir) mkdirSync(dirname(dataDir), { recursive: true });
  const pg = await mod.PGlite.create({ ...(dataDir ? { dataDir } : {}), parsers: PARSERS });
  // PGlite is a single connection; serialise transactions so two concurrent
  // requests cannot interleave statements inside each other's BEGIN/COMMIT.
  let chain: Promise<unknown> = Promise.resolve();
  const run = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
    const res = await pg.query<T>(sql, (params ?? []) as unknown[]);
    return res.rows;
  };
  const exec = async (sql: string): Promise<void> => {
    await pg.exec(sql);
  };
  const db: Db = {
    kind: 'pglite',
    exec: (sql) => {
      const p = chain.then(() => exec(sql));
      chain = p.catch(() => undefined);
      return p;
    },
    query: (sql, params) => {
      // Statements outside a transaction still queue behind an open transaction.
      const p = chain.then(() => run(sql, params));
      chain = p.catch(() => undefined);
      return p as never;
    },
    tx: (fn) => {
      const p = chain.then(async () => {
        await run('BEGIN');
        try {
          const out = await fn({ query: run, exec });
          await run('COMMIT');
          return out;
        } catch (err) {
          await run('ROLLBACK');
          throw err;
        }
      });
      chain = p.catch(() => undefined);
      return p;
    },
    close: async () => {
      await chain;
      await pg.close();
    },
  };
  return db;
}

/**
 * Date-only columns come back as 'YYYY-MM-DD' strings and times as 'HH:MM'.
 * Parsing a date into a JS Date would attach a timezone to something that has
 * none, which is exactly how "due 22 Nov" silently becomes 21 Nov.
 */
const PARSERS: Record<number, (v: string) => unknown> = {
  1082: (v) => v, // date
  1083: (v) => v.slice(0, 5), // time
  20: (v) => Number(v), // int8 — amounts in minor units stay far below 2^53
};

async function connectPostgres(url: string): Promise<Db> {
  const pgName = 'pg';
  const { default: pg } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pgName)) as {
    default: { Pool: new (o: object) => PgPool; types: { setTypeParser(oid: number, fn: (v: string) => unknown): void } };
  };
  for (const [oid, fn] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), fn);
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
  return {
    kind: 'postgres',
    query: async (sql, params) => (await pool.query(sql, params ?? [])).rows as never,
    exec: async (sql) => {
      await pool.query(sql, []);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({
          query: async (sql, params) => (await client.query(sql, params ?? [])).rows as never,
          exec: async (sql) => {
            await client.query(sql);
          },
        });
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

interface PgPool {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>; release(): void }>;
  end(): Promise<void>;
}

// ---------------------------------------------------------------- migrations

export function migrationsDir(): string {
  return join(repoRoot(), 'packages', 'core', 'migrations');
}

export async function migrate(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.query<{ version: string }>('SELECT version FROM schema_migrations')).map((r) => r.version));
  const files = readdirSync(migrationsDir()).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const sql = readFileSync(join(migrationsDir(), file), 'utf8');
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    applied.push(version);
  }
  return applied;
}

// ---------------------------------------------------------------- helpers

/**
 * Runs fn in a transaction. Given a Db it opens one; given a handle that is
 * already inside a transaction it reuses it, so services compose without
 * deadlocking PGlite's single connection.
 */
export function withTx<T>(q: Queryable | Db, fn: (q: Queryable) => Promise<T>): Promise<T> {
  if ('tx' in q && typeof (q as Db).tx === 'function') return (q as Db).tx(fn);
  return fn(q);
}

export async function one<T = Row>(q: Queryable, sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await q.query<T>(sql, params);
  return rows[0] ?? null;
}

export async function must<T = Row>(q: Queryable, sql: string, params?: unknown[]): Promise<T> {
  const row = await one<T>(q, sql, params);
  if (!row) throw new Error('Expected a row');
  return row;
}
