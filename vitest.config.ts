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
    // DB integration tests opt in via env flag — they require a clean schema
    // pushed to the configured DATABASE_URL.
    setupFiles: ["test/setup.ts"],
  },
});
