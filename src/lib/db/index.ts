import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "@/lib/config";
import * as schema from "./schema";

/**
 * Lazy DB initialization. Both the raw postgres-js client and the Drizzle
 * wrapper are constructed on first access via Proxy.
 *
 * Why lazy:
 * - Next.js evaluates module scope at build time; without a runtime DATABASE_URL
 *   eager initialization crashes the build
 * - Tests can override DATABASE_URL via __resetDbForTesting() without import-time
 *   side effects
 *
 * The Proxy returns a typed Drizzle client identical in API to a normal
 * `drizzle(...)` call.
 */

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let cachedClient: postgres.Sql | null = null;
let cachedDb: DrizzleDb | null = null;

function init(): DrizzleDb {
  if (!cachedDb) {
    // DigitalOcean managed Postgres requires SSL; the CI Postgres service
    // container (used by integration tests) does not. Detect by host.
    const url = config.DATABASE_URL;
    const isLocal = /(?:^|@)(?:localhost|127\.0\.0\.1)(?::|\/)/.test(url);

    cachedClient = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: isLocal ? false : "require",
    });
    cachedDb = drizzle(cachedClient, { schema });
  }
  return cachedDb;
}

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const real = init();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/** For tests: drop the cached client/db so the next access reinitializes. */
export async function __resetDbForTesting() {
  if (cachedClient) {
    await cachedClient.end();
  }
  cachedClient = null;
  cachedDb = null;
}

/** For one-off scripts and tests: get the underlying postgres-js client. */
export function getRawClient(): postgres.Sql {
  init();
  return cachedClient!;
}
