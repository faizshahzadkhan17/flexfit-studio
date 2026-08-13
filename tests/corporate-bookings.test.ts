import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { companies, corporateBookings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { callerAs } from "./helpers/caller";
import { resetDb, insertUser, insertClass, insertCompany, linkCompanyMember, hoursFromNow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

describe("corporateBookings.book — company credit pool", () => {
  it("spends from the company's shared pool, not a personal membership", async () => {
    const member = await insertUser({ email: "corp1@test.local" });
    const company = await insertCompany({ creditPoolBalance: 20 });
    await linkCompanyMember(member.id, company.id);
    const cls = await insertClass({ capacity: 10, creditCost: 3 });

    const result = await callerAs(member).corporateBookings.book({ classId: cls.id });
    expect(result.status).toBe("booked");

    const co = await db.query.companies.findFirst({ where: eq(companies.id, company.id) });
    expect(co?.creditPoolBalance).toBe(17);
  });

  it("rejects booking when the company pool has insufficient credits", async () => {
    const member = await insertUser({ email: "corp2@test.local" });
    const company = await insertCompany({ creditPoolBalance: 1 });
    await linkCompanyMember(member.id, company.id);
    const cls = await insertClass({ capacity: 10, creditCost: 2 });

    await expect(callerAs(member).corporateBookings.book({ classId: cls.id })).rejects.toMatchObject({
      message: "Your company does not have enough credits.",
    });
  });

  it("rejects booking for a member not linked to any active company", async () => {
    const member = await insertUser({ email: "corp3@test.local" });
    const cls = await insertClass({ capacity: 10 });

    await expect(callerAs(member).corporateBookings.book({ classId: cls.id })).rejects.toMatchObject({
      message: "You are not linked to an active company.",
    });
  });

  it("uses a 24-hour free-cancellation window (vs. 12 for individual bookings)", async () => {
    const member = await insertUser({ email: "corp4@test.local" });
    const company = await insertCompany({ creditPoolBalance: 20 });
    await linkCompanyMember(member.id, company.id);
    // 18 hours out: inside the 24h corporate window boundary, so NOT refundable.
    const cls = await insertClass({ capacity: 10, creditCost: 2, startsAt: hoursFromNow(18) });

    const booking = await callerAs(member).corporateBookings.book({ classId: cls.id });
    const result = await callerAs(member).corporateBookings.cancel({ bookingId: booking.id });

    expect(result.refunded).toBe(false);
    const co = await db.query.companies.findFirst({ where: eq(companies.id, company.id) });
    expect(co?.creditPoolBalance).toBe(18); // stayed spent
  });

  it("refunds the pool when cancelling >= 24 hours out", async () => {
    const member = await insertUser({ email: "corp5@test.local" });
    const company = await insertCompany({ creditPoolBalance: 20 });
    await linkCompanyMember(member.id, company.id);
    const cls = await insertClass({ capacity: 10, creditCost: 2, startsAt: hoursFromNow(48) });

    const booking = await callerAs(member).corporateBookings.book({ classId: cls.id });
    const result = await callerAs(member).corporateBookings.cancel({ bookingId: booking.id });

    expect(result.refunded).toBe(true);
    const co = await db.query.companies.findFirst({ where: eq(companies.id, company.id) });
    expect(co?.creditPoolBalance).toBe(20);
  });

  it("promotes the longest-waiting waitlisted corporate booking (FIFO), mirroring individual bookings", async () => {
    const memberA = await insertUser({ email: "corp6a@test.local" });
    const memberB = await insertUser({ email: "corp6b@test.local" });
    const company = await insertCompany({ creditPoolBalance: 20 });
    await linkCompanyMember(memberA.id, company.id);
    await linkCompanyMember(memberB.id, company.id);
    const cls = await insertClass({ capacity: 1, creditCost: 2, startsAt: hoursFromNow(48) });

    const bookingA = await callerAs(memberA).corporateBookings.book({ classId: cls.id });
    await callerAs(memberB).corporateBookings.book({ classId: cls.id });

    await callerAs(memberA).corporateBookings.cancel({ bookingId: bookingA.id });

    const rows = await db.select().from(corporateBookings).where(eq(corporateBookings.classId, cls.id));
    const bStatus = rows.find((r) => r.userId === memberB.id)?.status;
    expect(bStatus).toBe("booked");
  });
});
