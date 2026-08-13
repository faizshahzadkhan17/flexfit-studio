import type { APIRequestContext, Page } from "@playwright/test";

export const DEMO = {
  admin: { email: "admin@flexfit.test", password: "admin123" },
  trainer: { email: "arjun@flexfit.test", password: "trainer123" },
  member: { email: "rahul.k@example.com", password: "member123" },
  member2: { email: "meera.n@example.com", password: "member123" },
};

/** Logs in through the real login form, like a user would. */
export async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Logs in over the tRPC API directly (bypassing the login form) for setting
 * up test fixtures — e.g. creating a throwaway class as admin before a spec
 * exercises the member-facing UI against it. `request` keeps its own cookie
 * jar, so subsequent calls on the same context stay authenticated.
 */
export async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const res = await request.post("/api/trpc/auth.login", {
    data: { json: { email, password } },
  });
  if (!res.ok()) {
    throw new Error(`apiLogin failed for ${email}: ${res.status()} ${await res.text()}`);
  }
}

export async function apiCreateClass(
  request: APIRequestContext,
  overrides: {
    name?: string;
    capacity?: number;
    creditCost?: number;
    hoursFromNow?: number;
    room?: string;
  } = {},
) {
  const startsAt = new Date();
  startsAt.setHours(startsAt.getHours() + (overrides.hoursFromNow ?? 48));

  const res = await request.post("/api/trpc/classes.create", {
    data: {
      json: {
        name: overrides.name ?? `E2E Class ${Date.now()}`,
        room: overrides.room ?? "E2E Room",
        capacity: overrides.capacity ?? 10,
        creditCost: overrides.creditCost ?? 1,
        startsAt: startsAt.toISOString(),
      },
    },
  });
  if (!res.ok()) {
    throw new Error(`apiCreateClass failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return body.result.data.json as { id: number; name: string };
}
