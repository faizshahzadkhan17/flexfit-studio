import { test, expect } from "@playwright/test";
import { DEMO, loginViaUi, apiLogin, apiCreateClass } from "./helpers";

/**
 * Booking itself is set up over the API rather than by clicking through
 * /schedule: that page can't be used in a real browser (see Issue 7 in
 * FEATURE_INVENTORY.md — an unmemoized timestamp in its query means it
 * never stops re-fetching and never renders the class list). The dashboard
 * and its Cancel button don't share that bug, so this still exercises a
 * real rendered UI for the part of the flow that's actually usable.
 */
test("a booked class appears on the member's dashboard", async ({ page, request }) => {
  await apiLogin(request, DEMO.admin.email, DEMO.admin.password);
  const cls = await apiCreateClass(request, { name: `Book Me ${Date.now()}`, capacity: 10 });

  await apiLogin(request, DEMO.member.email, DEMO.member.password);
  const bookRes = await request.post("/api/trpc/bookings.book", { data: { json: { classId: cls.id } } });
  expect(bookRes.ok()).toBe(true);

  await loginViaUi(page, DEMO.member.email, DEMO.member.password);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: cls.name })).toBeVisible();
});

test("member can cancel a booking from the dashboard; it stays listed as cancelled, not removed", async ({
  page,
  request,
}) => {
  await apiLogin(request, DEMO.admin.email, DEMO.admin.password);
  const cls = await apiCreateClass(request, { name: `Cancel Me ${Date.now()}`, capacity: 10 });

  await apiLogin(request, DEMO.member.email, DEMO.member.password);
  const bookRes = await request.post("/api/trpc/bookings.book", { data: { json: { classId: cls.id } } });
  expect(bookRes.ok()).toBe(true);

  await loginViaUi(page, DEMO.member.email, DEMO.member.password);
  await page.goto("/dashboard");
  const bookingRow = page.locator(".panel", { hasText: cls.name });
  await expect(bookingRow).toBeVisible();
  await bookingRow.getByRole("button", { name: "Cancel" }).click();

  // bookings.mine doesn't filter by status, so a cancelled booking for a
  // still-future class stays visible with a "cancelled" badge; only the
  // Cancel/Reschedule buttons go away. Confirming that, not a removal.
  await expect(bookingRow.getByText("cancelled")).toBeVisible();
  await expect(bookingRow.getByRole("button", { name: "Cancel" })).not.toBeVisible();
});

test("booking a full class waitlists instead, reflected on the member's waitlist page", async ({ page, request }) => {
  await apiLogin(request, DEMO.admin.email, DEMO.admin.password);
  const cls = await apiCreateClass(request, { name: `Full Class ${Date.now()}`, capacity: 1 });

  await apiLogin(request, DEMO.member2.email, DEMO.member2.password);
  const fillRes = await request.post("/api/trpc/bookings.book", { data: { json: { classId: cls.id } } });
  expect(fillRes.ok()).toBe(true);

  await apiLogin(request, DEMO.member.email, DEMO.member.password);
  const secondRes = await request.post("/api/trpc/bookings.book", { data: { json: { classId: cls.id } } });
  expect(secondRes.ok()).toBe(true);
  const secondBody = await secondRes.json();
  expect(secondBody.result.data.json.status).toBe("waitlisted");

  await loginViaUi(page, DEMO.member.email, DEMO.member.password);
  await page.goto("/waitlist");
  const row = page.locator(".panel", { hasText: cls.name });
  await expect(row).toBeVisible();
  await expect(row.getByText("#1 in queue")).toBeVisible();
});
