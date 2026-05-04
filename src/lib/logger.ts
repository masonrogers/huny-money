import { redact } from "./utils/redact";

/**
 * Structured JSON logger to stdout.
 *
 * Every log line is a single JSON object. Production observability tools
 * (DigitalOcean log forwarders, etc.) parse these directly. Local dev sees
 * raw JSON in the terminal, which is fine.
 *
 * All payloads run through redact() before serialization to avoid leaking
 * secrets even when component authors are careless.
 */

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...(context ? { context: redact(context) } : {}),
  };
  // Use console methods so test runners can capture/redirect appropriately.
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export const log = {
  debug: (message: string, context?: Record<string, unknown>) => emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
