import { z } from 'zod/v4';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  COINBASE_API_KEY: z.string().min(1, 'COINBASE_API_KEY is required'),
  COINBASE_API_SECRET: z.string().min(1, 'COINBASE_API_SECRET is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),
  ALERT_WEBHOOK_URL: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
});

type EnvConfig = z.infer<typeof envSchema>;

let _cached: EnvConfig | null = null;

function loadConfig(): EnvConfig {
  if (_cached) return _cached;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const isDev = process.env.NODE_ENV !== 'production';
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    if (isDev) {
      console.warn(
        `⚠️  Missing or invalid environment variables:\n${errors}\n` +
          'Continuing in development mode with defaults where possible.'
      );
      // Return partial config with empty strings for missing required values in dev
      const fallback: EnvConfig = {
        DATABASE_URL: process.env.DATABASE_URL ?? '',
        COINBASE_API_KEY: process.env.COINBASE_API_KEY ?? '',
        COINBASE_API_SECRET: process.env.COINBASE_API_SECRET ?? '',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
        CRON_SECRET: process.env.CRON_SECRET ?? '',
        ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      };
      _cached = fallback;
      return fallback;
    }

    throw new Error(
      `❌ Invalid environment variables:\n${errors}\n` +
        'Please check your .env file or environment configuration.'
    );
  }

  _cached = result.data;
  return result.data;
}

/**
 * Lazy-loaded config. Validation runs on first property access, not at import time.
 * This prevents build-time crashes when env vars are not available.
 */
export const config: EnvConfig = new Proxy({} as EnvConfig, {
  get(_target, prop: string) {
    const resolved = loadConfig();
    return resolved[prop as keyof EnvConfig];
  },
});
