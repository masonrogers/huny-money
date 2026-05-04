/**
 * Lazy-initialized config. Env var validation deferred to first use so that
 * Next.js build-time evaluation doesn't crash on missing values.
 *
 * Crashes loudly on missing required values when first accessed.
 */

type Required = "DATABASE_URL" | "ANTHROPIC_API_KEY" | "COINBASE_API_KEY" | "COINBASE_API_SECRET" | "APP_SECRET" | "ADMIN_PASSWORD" | "CRON_SECRET";

type Optional = "NEXT_PUBLIC_APP_URL" | "NODE_ENV";

type ConfigShape = Record<Required, string> & Record<Optional, string | undefined>;

let cached: ConfigShape | null = null;

function load(): ConfigShape {
  const required: Required[] = [
    "DATABASE_URL",
    "ANTHROPIC_API_KEY",
    "COINBASE_API_KEY",
    "COINBASE_API_SECRET",
    "APP_SECRET",
    "ADMIN_PASSWORD",
    "CRON_SECRET",
  ];

  const missing: string[] = [];
  const result: Record<string, string | undefined> = {};

  for (const key of required) {
    const value = process.env[key];
    if (!value) {
      missing.push(key);
    } else {
      result[key] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Set them in .env.local (development) or in the DigitalOcean app spec (production).`,
    );
  }

  result.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
  result.NODE_ENV = process.env.NODE_ENV;

  return result as ConfigShape;
}

export const config = new Proxy({} as ConfigShape, {
  get(_target, prop: string) {
    if (!cached) {
      cached = load();
    }
    return cached[prop as keyof ConfigShape];
  },
});

/** For tests: reset the cached config so the next access re-reads process.env. */
export function __resetConfigForTesting() {
  cached = null;
}
