import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { memberships, bookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { callerAs } from "./helpers/caller";
import { resetDb, insertUser, insertPlan, insertMembership, insertClass, hoursFromNow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

describe("reschedules.reschedule", () => {
  it("moves the booking to the target class without re-charging credits", async () => {
    const member = await insertUser({ email: "resched@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const from = await insertClass({ name: "Sunrise Yoga", capacity: 10, startsAt: hoursFromNow(48), creditCost: 1 });
    const to = await insertClass({ name: "Sunrise Yoga", capacity: 10, startsAt: hoursFromNow(72), creditCost: 3 });

    const booking = await callerAs(member).bookings.book({ classId: from.id });
    const result = await callerAs(member).reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    expect(result.newStatus).toBe("booked");
    // Credit carryover: the new booking keeps the ORIGINAL 1 credit, even
    // though the target class's own creditCost is 3.
    expect(result.newBooking.creditsUsed).toBe(1);

    const ms = await db.query.memberships.findFirst({ where: eq(memberships.userId, member.id) });
    expect(ms?.creditsRemaining).toBe(9); // only ever charged once, at the original booking

    const oldBooking = await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
    expect(oldBooking?.status).toBe("cancelled");
  });

  it("rejects rescheduling to a class with a different name", async () => {
    const member = await insertUser({ email: "resched2@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const from = await insertClass({ name: "Sunrise Yoga", capacity: 10, startsAt: hoursFromNow(48) });
    const to = await insertClass({ name: "HIIT Circuit", capacity: 10, startsAt: hoursFromNow(72) });

    const booking = await callerAs(member).bookings.book({ classId: from.id });

    await expect(
      callerAs(member).reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id }),
    ).rejects.toMatchObject({ message: "You can only reschedule to a class with the same name." });
  });

  it("rejects rescheduling within the 4-hour cutoff of the original class", async () => {
    const member = await insertUser({ email: "resched3@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(member.id, plan.id, { creditsRemaining: 10 });
    const from = await insertClass({ name: "Spin 45", capacity: 10, startsAt: hoursFromNow(3) });
    const to = await insertClass({ name: "Spin 45", capacity: 10, startsAt: hoursFromNow(72) });

    const booking = await callerAs(member).bookings.book({ classId: from.id });

    await expect(
      callerAs(member).reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id }),
    ).rejects.toMatchObject({
      message: "You can only reschedule up to 4 hours before the class starts.",
    });
  });

  it("waitlists into the target class when it's already full", async () => {
    const memberA = await insertUser({ email: "resched4a@test.local" });
    const memberB = await insertUser({ email: "resched4b@test.local" });
    const plan = await insertPlan({ classCredits: 10 });
    await insertMembership(memberA.id, plan.id, { creditsRemaining: 10 });
    await insertMembership(memberB.id, plan.id, { creditsRemaining: 10 });
    const from = await insertClass({ name: "Boxing", capacity: 10, startsAt: hoursFromNow(48) });
    const to = await insertClass({ name: "Boxing", capacity: 1, startsAt: hoursFromNow(72) });

    // Fill the target class first.
    await callerAs(memberB).bookings.book({ classId: to.id });

    const booking = await callerAs(memberA).bookings.book({ classId: from.id });
    const result = await callerAs(memberA).reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    expect(result.newStatus).toBe("waitlisted");
  });
});
