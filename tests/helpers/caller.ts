import { db } from "@/db";
import { appRouter } from "@/server/routers/_app";
import type { User } from "@/db/schema";

/**
 * Builds a tRPC caller as a given user, bypassing HTTP/cookies entirely.
 * Router-level `protectedProcedure`/`staffProcedure`/`adminProcedure` guards
 * still run exactly as they do in production — only `createContext`'s
 * cookie-reading is skipped, since it depends on a real request.
 */
export function callerAs(user: User | null) {
  return appRouter.createCaller({ db, user, token: undefined });
}
