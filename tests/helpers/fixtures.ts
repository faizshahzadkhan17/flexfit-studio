import { db } from "@/db";
import {
  users,
  sessions,
  membershipPlans,
  memberships,
  classes,
  bookings,
  checkins,
  payments,
  notifications,
  trainerAvailability,
  companies,
  companyMembers,
  corporateBookings,
  reschedules,
  type User,
  type MembershipPlan,
  type Membership,
  type GymClass,
  type Company,
  type Payment,
} from "@/db/schema";
import { hashPassword } from "@/lib/password";

/** Wipes every table in FK-safe order. Call from `beforeEach`. */
export async function resetDb() {
  await db.delete(reschedules);
  await db.delete(corporateBookings);
  await db.delete(companyMembers);
  await db.delete(companies);
  await db.delete(notifications);
  await db.delete(sessions);
  await db.delete(checkins);
  await db.delete(bookings);
  await db.delete(payments);
  await db.delete(memberships);
  await db.delete(classes);
  await db.delete(membershipPlans);
  await db.delete(trainerAvailability);
  await db.delete(users);
}

function isoDateOnly(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export async function insertUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<User> {
  return db
    .insert(users)
    .values({
      email: overrides.email ?? `user-${Date.now()}-${Math.random()}@test.local`,
      passwordHash: hashPassword("password123"),
      name: "Test User",
      role: "member",
      active: true,
      ...overrides,
    })
    .returning()
    .get();
}

export async function insertPlan(
  overrides: Partial<typeof membershipPlans.$inferInsert> = {},
): Promise<MembershipPlan> {
  return db
    .insert(membershipPlans)
    .values({
      name: "Test Plan",
      priceCents: 100000,
      durationDays: 30,
      classCredits: 10,
      active: true,
      ...overrides,
    })
    .returning()
    .get();
}

export async function insertMembership(
  userId: number,
  planId: number,
  overrides: Partial<typeof memberships.$inferInsert> = {},
): Promise<Membership> {
  return db
    .insert(memberships)
    .values({
      userId,
      planId,
      startDate: isoDateOnly(-1),
      endDate: isoDateOnly(29),
      creditsRemaining: 10,
      status: "active",
      ...overrides,
    })
    .returning()
    .get();
}

export async function insertClass(
  overrides: Partial<typeof classes.$inferInsert> = {},
): Promise<GymClass> {
  const startsAt = new Date();
  startsAt.setHours(startsAt.getHours() + 48);
  return db
    .insert(classes)
    .values({
      name: "Test Class",
      room: "Test Room",
      capacity: 10,
      startsAt: startsAt.toISOString(),
      durationMin: 60,
      creditCost: 1,
      cancelled: false,
      ...overrides,
    })
    .returning()
    .get();
}

export async function insertCompany(
  overrides: Partial<typeof companies.$inferInsert> = {},
): Promise<Company> {
  return db
    .insert(companies)
    .values({
      name: "Test Co",
      contactEmail: "hr@testco.local",
      creditPoolBalance: 20,
      active: true,
      ...overrides,
    })
    .returning()
    .get();
}

export async function linkCompanyMember(userId: number, companyId: number) {
  await db.insert(companyMembers).values({ userId, companyId });
}

export async function insertPaidPayment(
  overrides: Partial<typeof payments.$inferInsert> & { userId: number },
): Promise<Payment> {
  return db
    .insert(payments)
    .values({
      amountCents: 100000,
      method: "card",
      status: "paid",
      reference: `PAY-TEST-${Date.now()}-${Math.random()}`,
      ...overrides,
    })
    .returning()
    .get();
}

/** Hours-from-now ISO timestamp, for building classes at a specific offset. */
export function hoursFromNow(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}
