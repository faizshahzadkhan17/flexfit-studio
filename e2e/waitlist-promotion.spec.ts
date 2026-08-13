import { test, expect } from "@playwright/test";
import { DEMO, loginViaUi, apiLogin, apiCreateClass } from "./helpers";

/**
 * Booking/waitlisting setup goes through the API rather than clicking
 * through /schedule — see the comment in member-booking.spec.ts and Issue 7
 * in FEATURE_INVENTORY.md. The parts that ARE exercised through the real
 * UI here (the waitlist page, the dashboard, the Cancel button) don't share
 * that bug.
 */
test("cancelling a full class promotes the waitlisted member, visible in both members' UIs", async ({
  browser,
  request,
}) => {
  await apiLogin(request, DEMO.admin.email, DEMO.admin.password);
  const cls = await apiCreateClass(request, { name: `Promo Class ${Date.now()}`, capacity: 1 });

  await apiLogin(request, DEMO.member.email, DEMO.member.password);
  const bookingARes = await request.post("/api/trpc/bookings.book", { data: { json: { classId: cls.id } } });
  expect(bookingARes.ok()).toBe(true);

  await apiLogin(request, DEMO.member2.email, DEMO.member2.password);
  const bookingBRes = await request.post("/api/trpc/bookings.book", { data: { json: { classId: cls.id } } });
  expect(bookingBRes.ok()).toBe(true);
  expect((await bookingBRes.json()).result.data.json.status).toBe("waitlisted");

  const memberACtx = await browser.newContext();
  const memberBCtx = await browser.newContext();
  const pageA = await memberACtx.newPage();
  const pageB = await memberBCtx.newPage();

  await loginViaUi(pageB, DEMO.member2.email, DEMO.member2.password);
  await pageB.goto("/waitlist");
  const waitlistRow = pageB.locator(".panel", { hasText: cls.name });
  await expect(waitlistRow).toBeVisible();
  await expect(waitlistRow.getByText("#1 in queue")).toBeVisible();

  // Member A (holding the confirmed spot) cancels via the dashboard UI.
  // (bookings.mine doesn't filter by status, so the row stays listed as
  // "cancelled" rather than disappearing — see member-booking.spec.ts.)
  await loginViaUi(pageA, DEMO.member.email, DEMO.member.password);
  await pageA.goto("/dashboard");
  const rowA = pageA.locator(".panel", { hasText: cls.name });
  await rowA.getByRole("button", { name: "Cancel" }).click();
  await expect(rowA.getByText("cancelled")).toBeVisible();

  // Member B should now be promoted: gone from the waitlist page...
  await pageB.goto("/waitlist");
  await expect(pageB.getByText("You're not waitlisted for any classes.")).toBeVisible();

  // ...and showing as a confirmed booking on their dashboard.
  await pageB.goto("/dashboard");
  await expect(pageB.locator(".panel", { hasText: cls.name })).toBeVisible();
  await expect(pageB.locator(".panel", { hasText: cls.name }).getByText("booked")).toBeVisible();

  await memberACtx.close();
  await memberBCtx.close();
});
