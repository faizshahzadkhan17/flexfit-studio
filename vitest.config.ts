import path from "node:path";
import { defineConfig } from "vitest/config";
import { TEST_DB_URL } from "./tests/setup/test-db";

export default defineConfig({
  test: {
    environment: "node",
    env: { DB_FILE: TEST_DB_URL },
    globalSetup: ["./tests/setup/global-setup.ts"],
    // Router tests share one SQLite file; running files in parallel would
    // let them stomp on each other's rows mid-test.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
