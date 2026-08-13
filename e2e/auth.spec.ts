import { test, expect } from "@playwright/test";
import { DEMO, loginViaUi } from "./helpers";

test("member can log in and reach the dashboard", async ({ page }) => {
  await loginViaUi(page, DEMO.member.email, DEMO.member.password);
  await expect(page.getByRole("heading", { name: /Hello, Rahul/ })).toBeVisible();
});

test("wrong password shows an inline error and stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(DEMO.member.email);
  await page.locator('input[type="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("signed-in user can sign out and loses access to the dashboard message", async ({ page }) => {
  await loginViaUi(page, DEMO.member.email, DEMO.member.password);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("Please sign in to view your bookings.")).toBeVisible();
});
