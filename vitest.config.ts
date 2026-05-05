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
    // Integration tests share DB state — opt them into a single fork so
    // they don't race. Pure tests run with the default pool concurrency.
    fileParallelism: !process.env.RUN_INTEGRATION,
  },
});
