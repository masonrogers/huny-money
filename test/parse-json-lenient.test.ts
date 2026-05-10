import { describe, it, expect } from "vitest";
import { parseJsonLenient } from "@/lib/anthropic/client";

/**
 * Locks in the markdown-fence handling that recovers Anthropic responses.
 *
 * Live incident 2026-05-09: the morning Opus brief came back as
 *   ```json\n{...}\n```
 * — the bare `JSON.parse` failed, parsedResponse was stored as null, the
 * morning-brief flow threw, Sonnet checkpoints kept skipping with "no recent
 * morning brief", and the operator saw API spend going up with zero usable
 * AI activity. parseJsonLenient is the fix.
 */

describe("parseJsonLenient", () => {
  it("parses raw JSON directly", () => {
    expect(parseJsonLenient('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null for empty / whitespace-only input", () => {
    expect(parseJsonLenient("")).toBeNull();
    expect(parseJsonLenient("   ")).toBeNull();
  });

  it("strips ```json ... ``` markdown fence", () => {
    const input = '```json\n{"regime":"chop"}\n```';
    expect(parseJsonLenient(input)).toEqual({ regime: "chop" });
  });

  it("strips bare ``` ... ``` markdown fence", () => {
    const input = '```\n{"regime":"chop"}\n```';
    expect(parseJsonLenient(input)).toEqual({ regime: "chop" });
  });

  it("handles a fence with trailing whitespace and newlines", () => {
    const input = '\n  ```json\n{"x":[1,2,3]}\n```  \n';
    expect(parseJsonLenient(input)).toEqual({ x: [1, 2, 3] });
  });

  it("recovers when there's stray text before/after the JSON object", () => {
    const input = 'Here is the JSON:\n{"foo":"bar","n":42}\nLet me know!';
    expect(parseJsonLenient(input)).toEqual({ foo: "bar", n: 42 });
  });

  it("handles nested objects and arrays inside fences", () => {
    const input = `\`\`\`json
{
  "regime": "chop",
  "alt_entry_candidates": [
    {"asset":"AERO","conviction":75},
    {"asset":"LINK","conviction":62}
  ]
}
\`\`\``;
    expect(parseJsonLenient(input)).toEqual({
      regime: "chop",
      alt_entry_candidates: [
        { asset: "AERO", conviction: 75 },
        { asset: "LINK", conviction: 62 },
      ],
    });
  });

  it("returns null for genuinely malformed JSON", () => {
    expect(parseJsonLenient("```json\n{not valid\n```")).toBeNull();
    expect(parseJsonLenient("not json at all")).toBeNull();
  });

  it("preserves raw values like null / numbers / strings if directly parseable", () => {
    expect(parseJsonLenient("null")).toBeNull();
    // Note: parseJsonLenient returns null for genuine `null` because we can't
    // distinguish "couldn't parse" from "parsed and got null." Acceptable —
    // callers wanting strict behavior should use JSON.parse directly.
    expect(parseJsonLenient("42")).toBe(42);
    expect(parseJsonLenient('"hello"')).toBe("hello");
  });

  it("simulates the live 2026-05-09 morning-brief response", () => {
    const input = `\`\`\`json
{
  "regime": "chop",
  "regime_evidence": "BTC ranging $77k-$82.8k over the last 30 days...",
  "regime_changed_from": null,
  "btc_core_decision": {
    "current_alloc_pct": 0,
    "target_alloc_pct": 50,
    "action": "dca_in",
    "tranches_planned": 4,
    "reasoning": "BTC has held the $77k support..."
  }
}
\`\`\``;
    const result = parseJsonLenient(input) as { regime: string; btc_core_decision: { action: string } };
    expect(result.regime).toBe("chop");
    expect(result.btc_core_decision.action).toBe("dca_in");
  });
});
