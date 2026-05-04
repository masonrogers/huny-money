/**
 * Strips known-sensitive credential patterns from anything written to logs
 * or persisted to forensic tables.
 *
 * Defense in depth: even if a component accidentally passes credentials in
 * a context payload, redact() removes them before persistence.
 *
 * Patterns currently caught:
 * - Anthropic API keys (sk-ant-*)
 * - Coinbase CDP key names (organizations/{uuid}/apiKeys/{uuid})
 * - EC private keys (PEM blocks)
 * - PKCS#8 private keys (PEM blocks)
 * - Generic bearer tokens (Bearer {hexlike})
 * - Generic API key headers (api[-_]?key[=:][\w-]+)
 *
 * Replacement is the literal string `[REDACTED]`.
 */

const REDACTED = "[REDACTED]";

const PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "anthropic-key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "coinbase-cdp-key-name", regex: /organizations\/[a-f0-9-]{36}\/apiKeys\/[a-f0-9-]{36}/g },
  { name: "ec-private-key", regex: /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g },
  { name: "pkcs8-private-key", regex: /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g },
  { name: "rsa-private-key", regex: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g },
  { name: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9._-]{20,}/gi },
  { name: "api-key-kv", regex: /(api[-_]?key|apikey)\s*[=:]\s*['"]*[\w.-]{20,}['"]*\s*/gi },
];

function redactString(input: string): string {
  let out = input;
  for (const { regex } of PATTERNS) {
    out = out.replace(regex, REDACTED);
  }
  return out;
}

/**
 * Recursively redact a value. Strings are scrubbed; objects/arrays are walked.
 * Non-string primitives are returned unchanged.
 */
export function redact<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") {
    return redactString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v);
    }
    return out as T;
  }
  return value;
}
