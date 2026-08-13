import { test, expect } from "@playwright/test";
import { DEMO, loginViaUi, apiLogin, apiCreateClass } from "./helpers";

test("staff can look up a member at the kiosk and check them in to an upcoming class", async ({ page, request }) => {
  await apiLogin(request, DEMO.admin.email, DEMO.admin.password);
  const cls = await apiCreateClass(request, { name: `Kiosk Class ${Date.now()}`, hoursFromNow: 1, capacity: 10 });

  await apiLogin(request, DEMO.member.email, DEMO.member.password);
  const bookRes = await request.post("/api/trpc/bookings.book", { data: { json: { classId: cls.id } } });
  expect(bookRes.ok()).toBe(true);

  await loginViaUi(page, DEMO.admin.email, DEMO.admin.password);
  await page.goto("/kiosk");

  await page.getByPlaceholder("Email or phone number").fill(DEMO.member.email);
  await expect(page.getByRole("button", { name: "Select" })).toBeVisible();
  await page.getByRole("button", { name: "Select" }).click();

  const classRow = page.locator(".p-4", { hasText: cls.name });
  await expect(classRow).toBeVisible();
  await classRow.getByRole("button", { name: "Check in" }).click();

  await expect(page.getByText("✓ Check-in successful")).toBeVisible();
});

test("kiosk member lookup rejects a non-member (staff) email", async ({ page }) => {
  await loginViaUi(page, DEMO.admin.email, DEMO.admin.password);
  await page.goto("/kiosk");
  await page.getByPlaceholder("Email or phone number").fill(DEMO.trainer.email);
  await expect(page.getByText("Member not found")).toBeVisible();
});
