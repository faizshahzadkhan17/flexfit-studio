import { test, expect } from "@playwright/test";
import { DEMO, loginViaUi } from "./helpers";

/**
 * Characterizes FEATURE_INVENTORY.md Issue 7 directly: /schedule calls
 * `trpc.classes.list.useQuery({ from: new Date().toISOString() })` with the
 * timestamp computed inline on every render, so the query key changes every
 * render and the page never stops re-fetching or renders the class list.
 * Decision (2026-08-13): document-and-leave. This test asserts the CURRENT
 * (broken) behavior on purpose — if this page is ever fixed, this is the
 * test that should be updated to match, not silently left failing.
 */
test("known bug: /schedule never progresses past the loading state in a real browser", async ({ page }) => {
  await loginViaUi(page, DEMO.member.email, DEMO.member.password);

  const requests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("classes.list")) requests.push(req.url());
  });

  await page.goto("/schedule");
  await expect(page.getByText("Loading schedule...")).toBeVisible();

  // Give it several seconds of real time; a working page would have
  // resolved its first fetch in well under 100ms against the seeded DB.
  await page.waitForTimeout(3000);

  await expect(page.getByText("Loading schedule...")).toBeVisible();
  // The bug's signature: dozens of distinct classes.list calls, not one.
  expect(requests.length).toBeGreaterThan(10);
});
