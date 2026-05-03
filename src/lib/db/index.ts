import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import * as schema from './schema';

let _client: Sql | null = null;
let _db: PostgresJsDatabase<typeof schema> | null = null;

function getClient(): Sql {
  if (!_client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    _client = postgres(connectionString, { max: 5 });
  }
  return _client;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(getClient(), { schema });
  }
  return _db;
}

/**
 * Lazy-initialized database client and drizzle instance.
 * Connection is only established on first use, not at import time.
 */
export const client: Sql = new Proxy({} as Sql, {
  get(_target, prop) {
    const c = getClient();
    const val = (c as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof val === 'function') return val.bind(c);
    return val;
  },
  apply(_target, _thisArg, args) {
    const c = getClient();
    return (c as unknown as (...a: unknown[]) => unknown)(...args);
  },
});

export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop) {
      const d = getDb();
      const val = (d as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof val === 'function') return val.bind(d);
      return val;
    },
  }
);
