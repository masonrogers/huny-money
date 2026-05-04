import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import path from "path";

/**
 * Validates that the query helper enforcement script (scripts/lint-queries.sh)
 * actually fires when a violating file is introduced.
 *
 * Per STRATEGY.md §13.3, all production queries of `positions` and `orders`
 * MUST go through the mode-aware helpers in src/lib/db/queries/positions.ts
 * and orders.ts. The lint script is the CI defense — if it can be silently
 * bypassed, the safety guarantee evaporates.
 */

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/lint-queries.sh");
const VIOLATION_DIR = path.join(ROOT, "src/__lint_test__");
const VIOLATION_FILE = path.join(VIOLATION_DIR, "violation.ts");

afterEach(() => {
  if (existsSync(VIOLATION_FILE)) unlinkSync(VIOLATION_FILE);
  if (existsSync(VIOLATION_DIR)) {
    try {
      // rmdir if empty
      execSync(`rmdir "${VIOLATION_DIR}"`);
    } catch {
      // ignore
    }
  }
});

function run(): { code: number; out: string } {
  try {
    const out = execSync(`bash "${SCRIPT}"`, { encoding: "utf8" });
    return { code: 0, out };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: e.status ?? 1,
      out: (e.stdout ?? "") + (e.stderr ?? ""),
    };
  }
}

function plant(content: string): void {
  if (!existsSync(VIOLATION_DIR)) mkdirSync(VIOLATION_DIR, { recursive: true });
  writeFileSync(VIOLATION_FILE, content);
}

describe("lint-queries.sh", () => {
  it("passes on clean codebase", () => {
    const { code } = run();
    expect(code).toBe(0);
  });

  it("rejects a direct schema import of positions", () => {
    plant(`import { positions } from "@/lib/db/schema";
const x = positions;
`);
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toContain("violation.ts");
  });

  it("rejects a direct schema import of orders", () => {
    plant(`import { orders } from "../lib/db/schema";
const x = orders;
`);
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toContain("violation.ts");
  });

  it("rejects a direct from(positions) usage", () => {
    plant(`import { db } from "@/lib/db";
import { positions } from "@/lib/db/schema";
async function bad() { return db.select().from(positions); }
`);
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toContain("violation.ts");
  });

  it("rejects a direct db.update(positions) call", () => {
    plant(`import { db } from "@/lib/db";
import { positions } from "@/lib/db/schema";
async function bad() { return db.update(positions).set({}); }
`);
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toContain("violation.ts");
  });

  it("rejects a direct db.insert(orders) call", () => {
    plant(`import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
async function bad() { return db.insert(orders).values({}); }
`);
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toContain("violation.ts");
  });
});
