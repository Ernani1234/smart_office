import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations';

// Postgres de verdade (Supabase/Docker) ou PGlite (Postgres em WASM, com
// pgvector) quando não há DATABASE_URL. Mesmo SQL nos dois.

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  readonly kind: 'pglite' | 'postgres';
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

async function createPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite-pgvector');
  const dir = path.join(dataDir, 'pglite');
  mkdirSync(dir, { recursive: true });
  const pg = new PGlite({ dataDir: dir, extensions: { vector } });
  await pg.waitReady;
  // PGlite é single-thread: serializamos transações para não intercalar.
  let chain: Promise<unknown> = Promise.resolve();
  const db: Db = {
    kind: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pg.query<T>(sql, params as unknown[]);
      return r.rows;
    },
    tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R> {
      const run = chain.then(() =>
        pg.transaction(async (t) => {
          const q: Queryable = {
            async query<T>(sql: string, params: unknown[] = []) {
              const r = await t.query<T>(sql, params as unknown[]);
              return r.rows;
            },
          };
          return fn(q);
        }),
      );
      chain = run.catch(() => undefined);
      return run as Promise<R>;
    },
    async close() {
      await pg.close();
    },
  };
  return db;
}

async function createPostgres(url: string): Promise<Db> {
  const pgMod = await import('pg');
  const pg = pgMod.default ?? pgMod;
  pg.types.setTypeParser(20, (v: string) => Number.parseInt(v, 10)); // int8 → number
  pg.types.setTypeParser(1700, (v: string) => Number.parseFloat(v)); // numeric → number
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params as unknown[]);
      return r.rows as T[];
    },
    async tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const q: Queryable = {
          async query<T>(sql: string, params: unknown[] = []) {
            const r = await client.query(sql, params as unknown[]);
            return r.rows as T[];
          },
        };
        const result = await fn(q);
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function openDb(opts: { databaseUrl: string | null; dataDir: string }): Promise<Db> {
  const db = opts.databaseUrl ? await createPostgres(opts.databaseUrl) : await createPglite(opts.dataDir);
  for (const sql of MIGRATIONS) {
    await db.query(sql);
  }
  return db;
}

export function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return new Date(v).toISOString();
  return new Date().toISOString();
}

export function isoOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : iso(v);
}
