import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { memberships, bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { UNLIMITED_CREDITS } from "@/server/routers/bookings";
import { callerAs } from "./helpers/caller";
import {
  resetDb,
  insertUser,
  insertPlan,
  insertMembership,
  insertClass,
  hoursFromNow,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

describe("bookings.book — credit deduction", () => {
  it("charges one credit per booking and creates a booked row", async () => {
    const member = await insertUser({ email: "m1@test.local", role: "member" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ creditCost: 1, capacity: 10 });

    const result = await callerAs(member).bookings.book({ classId: cls.id });

    expect(result.status).toBe("booked");
    expect(result.creditsUsed).toBe(1);

    const ms = await db.query.memberships.findFirst({ where: eq(memberships.userId, member.id) });
    expect(ms?.creditsRemaining).toBe(9);
  });

  it("charges the class's own creditCost, not always 1", async () => {
    const member = await insertUser({ email: "m2@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ creditCost: 3, capacity: 10 });

    await callerAs(member).bookings.book({ classId: cls.id });

    const ms = await db.query.memberships.findFirst({ where: eq(memberships.userId, member.id) });
    expect(ms?.creditsRemaining).toBe(7);
  });

  it("never decrements an unlimited (999-credit) membership", async () => {
    const member = await insertUser({ email: "m3@test.local" });
    const plan = await insertPlan({ classCredits: UNLIMITED_CREDITS });
    await insertMembership(member.id, plan.id, { creditsRemaining: UNLIMITED_CREDITS });
    const cls = await insertClass({ creditCost: 2, capacity: 10 });

    await callerAs(member).bookings.book({ classId: cls.id });

    const ms = await db.query.memberships.findFirst({ where: eq(memberships.userId, member.id) });
    expect(ms?.creditsRemaining).toBe(UNLIMITED_CREDITS);
  });

  it("rejects booking when credits are insufficient, without charging anything", async () => {
    const member = await insertUser({ email: "m4@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 1 });
    const cls = await insertClass({ creditCost: 2, capacity: 10 });

    await expect(callerAs(member).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      message: "Not enough class credits remaining.",
    });

    const ms = await db.query.memberships.findFirst({ where: eq(memberships.userId, member.id) });
    expect(ms?.creditsRemaining).toBe(1);
  });

  it("rejects booking with no active membership", async () => {
    const member = await insertUser({ email: "m5@test.local" });
    const cls = await insertClass({ capacity: 10 });

    await expect(callerAs(member).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      message: "An active membership is required to book classes.",
    });
  });

  it("rejects a membership that has expired", async () => {
    const member = await insertUser({ email: "m6@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, {
      creditsRemaining: 10,
      startDate: "2020-01-01",
      endDate: "2020-01-31",
      status: "active",
    });
    const cls = await insertClass({ capacity: 10 });

    await expect(callerAs(member).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      message: "An active membership is required to book classes.",
    });
  });

  it("waitlists instead of booking when the class is full, and charges no credit", async () => {
    const memberA = await insertUser({ email: "a@test.local" });
    const memberB = await insertUser({ email: "b@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(memberA.id, plan.id, { creditsRemaining: 10 });
    await insertMembership(memberB.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 1, creditCost: 1 });

    await callerAs(memberA).bookings.book({ classId: cls.id });
    const second = await callerAs(memberB).bookings.book({ classId: cls.id });

    expect(second.status).toBe("waitlisted");
    expect(second.creditsUsed).toBe(0);

    const msB = await db.query.memberships.findFirst({ where: eq(memberships.userId, memberB.id) });
    expect(msB?.creditsRemaining).toBe(10);
  });

  it("rejects a duplicate booking/waitlist attempt on the same class", async () => {
    const member = await insertUser({ email: "dup@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 10 });

    await callerAs(member).bookings.book({ classId: cls.id });

    await expect(callerAs(member).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      message: "You are already on the list for this class.",
    });
  });

  it("rejects booking a class that has already started", async () => {
    const member = await insertUser({ email: "started@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 10, startsAt: hoursFromNow(-1) });

    await expect(callerAs(member).bookings.book({ classId: cls.id })).rejects.toMatchObject({
      message: "This class has already started.",
    });
  });
});

describe("bookings.cancel — refund window and waitlist promotion", () => {
  it("refunds the credit when cancelling >= 12 hours before class start", async () => {
    const member = await insertUser({ email: "refund-ok@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 10, startsAt: hoursFromNow(48), creditCost: 1 });

    const booking = await callerAs(member).bookings.book({ classId: cls.id });
    const result = await callerAs(member).bookings.cancel({ bookingId: booking.id });

    expect(result.refunded).toBe(true);
    const ms = await db.query.memberships.findFirst({ where: eq(memberships.userId, member.id) });
    expect(ms?.creditsRemaining).toBe(10);
  });

  it("does NOT refund when cancelling < 12 hours before class start", async () => {
    const member = await insertUser({ email: "refund-late@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    // Book far enough out to succeed, then the class is only 6h away at cancel time.
    const cls = await insertClass({ capacity: 10, startsAt: hoursFromNow(6), creditCost: 1 });

    const booking = await callerAs(member).bookings.book({ classId: cls.id });
    const result = await callerAs(member).bookings.cancel({ bookingId: booking.id });

    expect(result.refunded).toBe(false);
    const ms = await db.query.memberships.findFirst({ where: eq(memberships.userId, member.id) });
    expect(ms?.creditsRemaining).toBe(9);
  });

  it("does not report a refund for leaving a waitlist (no credit was ever charged)", async () => {
    const memberA = await insertUser({ email: "wl-a@test.local" });
    const memberB = await insertUser({ email: "wl-b@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(memberA.id, plan.id, { creditsRemaining: 10 });
    await insertMembership(memberB.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 1, startsAt: hoursFromNow(48) });

    await callerAs(memberA).bookings.book({ classId: cls.id });
    const waitlisted = await callerAs(memberB).bookings.book({ classId: cls.id });

    const result = await callerAs(memberB).bookings.cancel({ bookingId: waitlisted.id });
    expect(result.refunded).toBe(false);
  });

  it("promotes the longest-waiting waitlisted member (FIFO) when a booked spot opens up", async () => {
    const memberA = await insertUser({ email: "fifo-a@test.local" });
    const memberB = await insertUser({ email: "fifo-b@test.local" });
    const memberC = await insertUser({ email: "fifo-c@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(memberA.id, plan.id, { creditsRemaining: 10 });
    await insertMembership(memberB.id, plan.id, { creditsRemaining: 10 });
    await insertMembership(memberC.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 1, startsAt: hoursFromNow(48), creditCost: 1 });

    const bookingA = await callerAs(memberA).bookings.book({ classId: cls.id });
    // B waitlists before C, so B must be promoted first.
    await callerAs(memberB).bookings.book({ classId: cls.id });
    await callerAs(memberC).bookings.book({ classId: cls.id });

    await callerAs(memberA).bookings.cancel({ bookingId: bookingA.id });

    const rows = await db.select().from(bookings).where(eq(bookings.classId, cls.id));
    const bStatus = rows.find((r) => r.userId === memberB.id)?.status;
    const cStatus = rows.find((r) => r.userId === memberC.id)?.status;
    expect(bStatus).toBe("booked");
    expect(cStatus).toBe("waitlisted");

    // Promotion charges the credit at promotion time.
    const msB = await db.query.memberships.findFirst({ where: eq(memberships.userId, memberB.id) });
    expect(msB?.creditsRemaining).toBe(9);
  });

  it("rejects cancelling a booking that isn't the caller's and the caller isn't staff", async () => {
    const owner = await insertUser({ email: "owner@test.local" });
    const stranger = await insertUser({ email: "stranger@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(owner.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 10, startsAt: hoursFromNow(48) });

    const booking = await callerAs(owner).bookings.book({ classId: cls.id });

    await expect(
      callerAs(stranger).bookings.cancel({ bookingId: booking.id }),
    ).rejects.toMatchObject({ message: "You cannot cancel this booking." });
  });

  it("allows staff to cancel another member's booking", async () => {
    const owner = await insertUser({ email: "owner2@test.local" });
    const trainer = await insertUser({ email: "trainer2@test.local", role: "trainer" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(owner.id, plan.id, { creditsRemaining: 10 });
    const cls = await insertClass({ capacity: 10, startsAt: hoursFromNow(48) });

    const booking = await callerAs(owner).bookings.book({ classId: cls.id });
    const result = await callerAs(trainer).bookings.cancel({ bookingId: booking.id });

    expect(result.ok).toBe(true);
  });
});
