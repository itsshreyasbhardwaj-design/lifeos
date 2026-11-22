/** Applies pending migrations. `--reset` deletes the local embedded database first (development only). */
import { rmSync } from 'node:fs';
import { connect, defaultDataDir, migrate } from '../packages/core/src/db.ts';

if (process.argv.includes('--reset')) {
  if (process.env.DATABASE_URL?.startsWith('postgres')) throw new Error('--reset only works on the embedded development database.');
  rmSync(defaultDataDir(), { recursive: true, force: true });
  console.log(`removed ${defaultDataDir()}`);
}
const db = await connect({ migrate: false });
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
await db.close();
