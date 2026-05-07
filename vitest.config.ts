import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // DB integration tests live under test/integration/ and skip themselves
    // unless RUN_INTEGRATION=1 is set. They require a clean schema pushed
    // to the configured DATABASE_URL.
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
    // Run test files serially. Two files (lint-queries, execution-isolation)
    // plant violation files under src/ and invoke scripts/lint-queries.sh,
    // which scans the entire src tree. With parallel files, one's plant()
    // can poison another's "baseline: clean codebase passes" assertion.
    // The unit suite finishes in <1s either way.
    fileParallelism: false,
  },
});
