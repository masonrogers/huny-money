import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { readFileSync } from "fs";
import path from "path";

/**
 * Static-isolation guarantees per STRATEGY.md §13.2 / §13.8.
 *
 * 1. paper-executor.ts MUST NOT import from coinbase/orders. This is the
 *    "no live order in paper mode" guarantee — provable by reading the
 *    file rather than running fetch spies.
 * 2. live-executor.ts is the ONLY file in the codebase that imports
 *    coinbase/orders. The CI lint rule enforces this; this test plants
 *    a violation and verifies the rule fires.
 */

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/lint-queries.sh");

const VIOLATION_DIR = path.join(ROOT, "src/__exec_test__");
const VIOLATION_FILE = path.join(VIOLATION_DIR, "violation.ts");

afterEach(() => {
  if (existsSync(VIOLATION_FILE)) unlinkSync(VIOLATION_FILE);
  if (existsSync(VIOLATION_DIR)) {
    try {
      execSync(`rmdir "${VIOLATION_DIR}"`);
    } catch {
      // ignore
    }
  }
});

function runLint(): { code: number; out: string } {
  try {
    const out = execSync(`bash "${SCRIPT}"`, { encoding: "utf8" });
    return { code: 0, out };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

function plant(content: string): void {
  if (!existsSync(VIOLATION_DIR)) mkdirSync(VIOLATION_DIR, { recursive: true });
  writeFileSync(VIOLATION_FILE, content);
}

describe("paper-executor.ts static isolation from coinbase/orders", () => {
  it("does not import @/lib/coinbase/orders anywhere in the file", () => {
    const file = readFileSync(path.join(ROOT, "src/lib/execution/paper-executor.ts"), "utf8");
    // Strip block comments and line comments before scanning — "coinbase/orders"
    // appearing in a doc comment is fine, importing it is not.
    const code = file
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/from\s+["'][^"']*coinbase\/orders["']/);
    expect(code).not.toMatch(/import\s*\(\s*["'][^"']*coinbase\/orders["']/);
  });

  it("does not import the live-executor file either", () => {
    const file = readFileSync(path.join(ROOT, "src/lib/execution/paper-executor.ts"), "utf8");
    const code = file
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/from\s+["'][^"']*live-executor["']/);
  });
});

describe("live-executor.ts static isolation from paper-executor", () => {
  it("does not import the paper-executor file", () => {
    const file = readFileSync(path.join(ROOT, "src/lib/execution/live-executor.ts"), "utf8");
    const code = file
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/from\s+["'][^"']*paper-executor["']/);
  });
});

describe("CI lint catches a planted coinbase/orders import", () => {
  it("baseline: clean codebase passes", () => {
    const r = runLint();
    expect(r.code).toBe(0);
  });

  it("planting an import of coinbase/orders outside live-executor fails the lint", () => {
    plant(`import { placeLimitBuy } from "@/lib/coinbase/orders";
async function bad() { return placeLimitBuy({ asset: "BTC", baseSize: "0.001", limitPrice: "60000" }); }
`);
    const r = runLint();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("coinbase/orders");
    expect(r.out).toContain("violation.ts");
  });
});
