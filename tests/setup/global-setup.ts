import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { TEST_DB_PATH, TEST_DB_URL } from "./test-db";

/**
 * Runs once before the whole Vitest run. Applies the real schema (via
 * drizzle-kit, same as `pnpm db:push`) to a throwaway SQLite file so tests
 * exercise the actual schema rather than a hand-copied approximation of it.
 */
export default async function setup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    if (existsSync(file)) rmSync(file);
  }

  execSync("npx drizzle-kit push --force", {
    stdio: "inherit",
    env: { ...process.env, DB_FILE: TEST_DB_URL },
  });
}
