import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { config, __resetConfigForTesting } from "@/lib/config";

const REQUIRED_KEYS = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "COINBASE_API_KEY",
  "COINBASE_API_SECRET",
  "APP_SECRET",
  "ADMIN_PASSWORD",
  "CRON_SECRET",
];

describe("config (lazy)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    __resetConfigForTesting();
    for (const k of REQUIRED_KEYS) {
      saved[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const k of REQUIRED_KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
    __resetConfigForTesting();
  });

  it("does not crash on import (lazy)", () => {
    // Just importing this file should not throw, even with missing env vars.
    // The proxy defers initialization until actual key access.
    expect(typeof config).toBe("object");
  });

  it("crashes loudly on missing required vars at first access", () => {
    for (const k of REQUIRED_KEYS) {
      delete process.env[k];
    }
    expect(() => config.DATABASE_URL).toThrow(/Missing required environment variables/);
  });

  it("returns required values when set", () => {
    for (const k of REQUIRED_KEYS) {
      process.env[k] = `test-${k.toLowerCase()}`;
    }
    expect(config.DATABASE_URL).toBe("test-database_url");
    expect(config.ANTHROPIC_API_KEY).toBe("test-anthropic_api_key");
    expect(config.APP_SECRET).toBe("test-app_secret");
  });

  it("returns undefined for unset optional vars", () => {
    for (const k of REQUIRED_KEYS) {
      process.env[k] = `test-${k.toLowerCase()}`;
    }
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(config.NEXT_PUBLIC_APP_URL).toBe(undefined);
  });
});
