import { describe, it, expect } from "vitest";
import { bucketRMultiples } from "@/app/api/dashboard/performance/route";

describe("bucketRMultiples", () => {
  it("returns 8 zero-count buckets on empty input", () => {
    const out = bucketRMultiples([]);
    expect(out).toHaveLength(8);
    expect(out.every((b) => b.count === 0)).toBe(true);
    expect(out.map((b) => b.bucket)).toEqual([
      "<-3R",
      "-3 to -2R",
      "-2 to -1R",
      "-1 to 0R",
      "0 to 1R",
      "1 to 2R",
      "2 to 3R",
      ">3R",
    ]);
  });

  it("places stop-loss exits (-1R) into the -1 to 0 bucket", () => {
    // -1.0 falls into "-1 to 0R" because the comparison is r < 0 (after r < -1 fails).
    // Actually -1 < -1 is false, so it goes to next branch: r < 0 → "-1 to 0R".
    const out = bucketRMultiples([-1.0]);
    expect(out.find((b) => b.bucket === "-1 to 0R")?.count).toBe(1);
  });

  it("places exact-target exits (+2R) into the 2 to 3R bucket", () => {
    const out = bucketRMultiples([2.0]);
    expect(out.find((b) => b.bucket === "2 to 3R")?.count).toBe(1);
  });

  it("places extreme outliers correctly", () => {
    const out = bucketRMultiples([-10, -3.5, 5, 100]);
    expect(out.find((b) => b.bucket === "<-3R")?.count).toBe(2); // -10, -3.5
    expect(out.find((b) => b.bucket === ">3R")?.count).toBe(2); // 5, 100
  });

  it("counts a typical mixed distribution", () => {
    // Simulate a rough swing-strategy distribution:
    // many small losses (-0.5 to -1), some 1-2R wins, a few big ones.
    const rs = [
      -0.8, -0.9, -0.95, // 3 stop-outs near 1R
      -1.5, // moderate loss (slippage past stop)
      0.5, 0.7, // small wins (early exits)
      1.5, 1.8, 2.0, // mid-target wins
      4.5, // home run
    ];
    const out = bucketRMultiples(rs);
    const map = Object.fromEntries(out.map((b) => [b.bucket, b.count]));
    expect(map["<-3R"]).toBe(0);
    expect(map["-2 to -1R"]).toBe(1);
    expect(map["-1 to 0R"]).toBe(3);
    expect(map["0 to 1R"]).toBe(2);
    expect(map["1 to 2R"]).toBe(2);
    expect(map["2 to 3R"]).toBe(1);
    expect(map[">3R"]).toBe(1);
  });
});
