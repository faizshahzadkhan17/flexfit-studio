import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { memberships, bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { callerAs } from "./helpers/caller";
import {
  resetDb,
  insertUser,
  insertPlan,
  insertMembership,
  insertClass,
  insertPaidPayment,
  hoursFromNow,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

describe("payments.refund", () => {
  it("refunds a paid payment and cancels the linked membership", async () => {
    const admin = await insertUser({ email: "radmin@test.local", role: "admin" });
    const member = await insertUser({ email: "rmember@test.local" });
    const plan = await insertPlan({ priceCents: 350000 });
    const membership = await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const payment = await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 350000 });

    const result = await callerAs(admin).payments.refund({ id: payment.id });
    expect(result.status).toBe("refunded");

    const ms = await db.query.memberships.findFirst({ where: eq(memberships.id, membership.id) });
    expect(ms?.status).toBe("cancelled");
  });

  it("blocks refunding a payment that isn't in 'paid' status (double-refund guard)", async () => {
    const admin = await insertUser({ email: "radmin2@test.local", role: "admin" });
    const member = await insertUser({ email: "rmember2@test.local" });
    const plan = await insertPlan();
    const membership = await insertMembership(member.id, plan.id);
    const payment = await insertPaidPayment({ userId: member.id, membershipId: membership.id });

    await callerAs(admin).payments.refund({ id: payment.id });

    await expect(callerAs(admin).payments.refund({ id: payment.id })).rejects.toMatchObject({
      message: "Only paid payments can be refunded.",
    });
  });

  it("leaves credits and existing bookings untouched after a refund (Issue 4, documented-and-left)", async () => {
    const admin = await insertUser({ email: "radmin3@test.local", role: "admin" });
    const member = await insertUser({ email: "rmember3@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    const membership = await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 10, startsAt: hoursFromNow(48), creditCost: 1 });

    const booking = await callerAs(member).bookings.book({ classId: cls.id });
    const payment = await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 350000 });

    await callerAs(admin).payments.refund({ id: payment.id });

    const ms = await db.query.memberships.findFirst({ where: eq(memberships.id, membership.id) });
    expect(ms?.creditsRemaining).toBe(9); // charged by the booking; refund doesn't touch it

    const bookingRow = await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
    expect(bookingRow?.status).toBe("booked"); // still attendable despite the refunded payment
  });
});

describe("payments.markPaid", () => {
  it("blocks marking a refunded payment as paid", async () => {
    const admin = await insertUser({ email: "mpadmin@test.local", role: "admin" });
    const member = await insertUser({ email: "mpmember@test.local" });
    const plan = await insertPlan();
    const membership = await insertMembership(member.id, plan.id);
    const payment = await insertPaidPayment({ userId: member.id, membershipId: membership.id });

    await callerAs(admin).payments.refund({ id: payment.id });

    await expect(callerAs(admin).payments.markPaid({ id: payment.id })).rejects.toMatchObject({
      message: "Refunded payments cannot be marked paid.",
    });
  });
});
