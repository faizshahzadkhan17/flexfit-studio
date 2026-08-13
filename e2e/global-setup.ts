import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

export const E2E_DB_PATH = "./flexfit.e2e.db";
export const E2E_DB_URL = `file:${E2E_DB_PATH}`;

/**
 * Runs once before the Playwright run. Builds a fresh, deterministically
 * seeded database (same seed script as `pnpm db:seed`) so specs can rely on
 * the documented demo accounts and plans without depending on whatever is
 * in the developer's own flexfit.db.
 */
export default async function globalSetup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = E2E_DB_PATH + suffix;
    if (existsSync(file)) rmSync(file);
  }

  const env = { ...process.env, DB_FILE: E2E_DB_URL };
  execSync("npx drizzle-kit push --force", { stdio: "inherit", env });
  execSync("npx tsx src/db/seed.ts", { stdio: "inherit", env });
}
