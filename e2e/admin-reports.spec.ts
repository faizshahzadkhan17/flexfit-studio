import { test, expect } from "@playwright/test";
import { DEMO, loginViaUi } from "./helpers";

test("admin dashboard shows the core stat tiles", async ({ page }) => {
  await loginViaUi(page, DEMO.admin.email, DEMO.admin.password);
  await page.goto("/admin");

  for (const label of ["Members", "Active memberships", "Upcoming classes", "Revenue", "Check-ins", "Pending payments"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
});

test("admin reports page renders revenue and expiring-membership sections", async ({ page }) => {
  await loginViaUi(page, DEMO.admin.email, DEMO.admin.password);
  await page.goto("/admin/reports");

  await expect(page.getByRole("heading", { name: "Revenue by Month" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revenue by Payment Method" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Memberships Expiring in 14 Days" })).toBeVisible();
});

test("non-admin (member) is denied access to the attendance report", async ({ page }) => {
  await loginViaUi(page, DEMO.member.email, DEMO.member.password);
  await page.goto("/admin/attendance");
  await expect(page.getByText("Access denied. Admins only.")).toBeVisible();
});

test("admin can create a corporate account from the companies page", async ({ page }) => {
  await loginViaUi(page, DEMO.admin.email, DEMO.admin.password);
  await page.goto("/admin/companies");

  const name = `E2E Corp ${Date.now()}`;
  await page.getByRole("button", { name: "New Company" }).click();
  await page.getByPlaceholder("e.g. TechCorp Inc").fill(name);
  await page.getByPlaceholder("contact@techcorp.com").fill(`hr-${Date.now()}@e2e.local`);
  await page.getByRole("button", { name: "Create Company" }).click();

  await expect(page.getByText("Company created successfully!")).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
});
