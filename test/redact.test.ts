import { describe, it, expect } from "vitest";
import { redact } from "@/lib/utils/redact";

describe("redact()", () => {
  it("strips Anthropic API keys", () => {
    const input = "key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890ABCD";
    expect(redact(input)).toBe("key=[REDACTED]");
  });

  it("strips Coinbase CDP key names", () => {
    const input =
      "name=organizations/4ecd07ab-1234-5678-90ab-cdef12345678/apiKeys/88674a25-1234-5678-90ab-cdef12345678";
    expect(redact(input)).toBe("name=[REDACTED]");
  });

  it("strips EC private key blocks", () => {
    const input = `prefix
-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIN3pretendkeycontentwhichshouldbescrubbedoAcGBSuBBAAKoUQDQgAEHIDDEN
-----END EC PRIVATE KEY-----
suffix`;
    const output = redact(input);
    expect(output).toContain("prefix");
    expect(output).toContain("suffix");
    expect(output).not.toContain("HIDDEN");
    expect(output).toContain("[REDACTED]");
  });

  it("strips PKCS#8 private key blocks", () => {
    const input = `before
-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAAhiddencontent
-----END PRIVATE KEY-----
after`;
    const output = redact(input);
    expect(output).not.toContain("hiddencontent");
    expect(output).toContain("[REDACTED]");
  });

  it("strips bearer tokens", () => {
    const input = "Authorization: Bearer abc123def456ghi789jkl012mno345pqr678";
    expect(redact(input)).toContain("[REDACTED]");
    expect(redact(input)).not.toContain("abc123def456");
  });

  it("strips api-key kv patterns", () => {
    const input = "config: api_key=verysecretvaluethatshouldnotbeloggedanywhere";
    expect(redact(input)).toContain("[REDACTED]");
    expect(redact(input)).not.toContain("verysecretvalue");
  });

  it("walks nested objects", () => {
    const input = {
      user: "alice",
      auth: { token: "Bearer abc123def456ghi789jkl012mno345pqr678zzz" },
      metadata: { keys: ["sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaa"] },
    };
    const out = redact(input);
    expect(out.user).toBe("alice");
    expect(JSON.stringify(out)).not.toContain("abc123def456");
    expect(JSON.stringify(out)).not.toContain("sk-ant-api03-aaaaaaaa");
    expect(JSON.stringify(out)).toContain("[REDACTED]");
  });

  it("walks arrays", () => {
    const input = ["clean", "Bearer abc123def456ghi789jkl012mno345pqr678zzz", { x: 1 }];
    const out = redact(input);
    expect(out[0]).toBe("clean");
    expect(out[1]).toContain("[REDACTED]");
    expect((out[2] as { x: number }).x).toBe(1);
  });

  it("preserves null, undefined, numbers, booleans", () => {
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(false)).toBe(false);
  });

  it("handles empty strings and objects", () => {
    expect(redact("")).toBe("");
    expect(redact({})).toEqual({});
    expect(redact([])).toEqual([]);
  });

  it("does not modify the input object (returns a new copy)", () => {
    const input = { a: { b: "Bearer abc123def456ghi789jkl012mno345pqr678" } };
    const original = JSON.parse(JSON.stringify(input));
    redact(input);
    expect(input).toEqual(original);
  });

  it("strips multiple credential patterns in the same string", () => {
    const input =
      "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaa and Bearer abc123def456ghi789jkl012mno345pqr678";
    const out = redact(input);
    // Both patterns scrubbed.
    expect(out).not.toContain("sk-ant-api03");
    expect(out).not.toContain("abc123def456");
    expect(out.split("[REDACTED]").length).toBeGreaterThanOrEqual(3);
  });
});
