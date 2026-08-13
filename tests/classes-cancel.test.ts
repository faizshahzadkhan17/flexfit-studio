import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { memberships, bookings, corporateBookings, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { callerAs } from "./helpers/caller";
import {
  resetDb,
  insertUser,
  insertPlan,
  insertMembership,
  insertClass,
  insertCompany,
  linkCompanyMember,
  hoursFromNow,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

/**
 * These tests encode CURRENT behavior for documents/FEATURE_INVENTORY.md
 * Issues 1 and 2, decided 2026-08-13 to be documented-and-left rather than
 * fixed during the refactor. They are intentionally asserting the buggy
 * behavior (no refund, waitlist left stranded) so the refactor can't
 * silently "fix" this without the test suite calling it out as a behavior
 * change. If Issues 1/2 are ever fixed on purpose, these assertions are the
 * ones that should flip.
 */
describe("classes.cancel — current (flagged, unfixed) credit and waitlist behavior", () => {
  it("does NOT refund a member's spent credit when the admin cancels the class (Issue 1)", async () => {
    const admin = await insertUser({ email: "admin@test.local", role: "admin" });
    const member = await insertUser({ email: "member@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 10, startsAt: hoursFromNow(48), creditCost: 1 });

    await callerAs(member).bookings.book({ classId: cls.id });
    await callerAs(admin).classes.cancel({ id: cls.id });

    const ms = await db.query.memberships.findFirst({ where: eq(memberships.userId, member.id) });
    // Documented gap: stays at 9, not restored to 10.
    expect(ms?.creditsRemaining).toBe(9);

    const row = await db.query.bookings.findFirst({ where: eq(bookings.userId, member.id) });
    expect(row?.status).toBe("cancelled");
  });

  it("does NOT touch a waitlisted booking when the admin cancels the class (Issue 2)", async () => {
    const admin = await insertUser({ email: "admin2@test.local", role: "admin" });
    const memberA = await insertUser({ email: "wla@test.local" });
    const memberB = await insertUser({ email: "wlb@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(memberA.id, plan.id, { creditsRemaining: 10 });
    await insertMembership(memberB.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 1, startsAt: hoursFromNow(48) });

    await callerAs(memberA).bookings.book({ classId: cls.id });
    await callerAs(memberB).bookings.book({ classId: cls.id });

    await callerAs(admin).classes.cancel({ id: cls.id });

    const waitlistRow = await db.query.bookings.findFirst({ where: eq(bookings.userId, memberB.id) });
    // Documented gap: still "waitlisted" for a class that is now cancelled.
    expect(waitlistRow?.status).toBe("waitlisted");
  });

  it("does NOT cancel or refund corporate bookings for the class (Issue 1, corporate half)", async () => {
    const admin = await insertUser({ email: "admin3@test.local", role: "admin" });
    const corpMember = await insertUser({ email: "corp@test.local" });
    const company = await insertCompany({ creditPoolBalance: 20 });
    await linkCompanyMember(corpMember.id, company.id);
    const cls = await insertClass({ capacity: 10, startsAt: hoursFromNow(48), creditCost: 2 });

    await callerAs(corpMember).corporateBookings.book({ classId: cls.id });
    await callerAs(admin).classes.cancel({ id: cls.id });

    const corpBooking = await db.query.corporateBookings.findFirst({
      where: eq(corporateBookings.userId, corpMember.id),
    });
    // Documented gap: stays "booked" even though the underlying class is cancelled.
    expect(corpBooking?.status).toBe("booked");

    const co = await db.query.companies.findFirst({ where: eq(companies.id, company.id) });
    // Documented gap: pool stays at 18, never refunded the 2 spent credits.
    expect(co?.creditPoolBalance).toBe(18);
  });
});
