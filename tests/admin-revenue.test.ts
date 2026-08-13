import { beforeEach, describe, expect, it } from "vitest";
import { callerAs } from "./helpers/caller";
import { resetDb, insertUser, insertPlan, insertMembership, insertPaidPayment } from "./helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

describe("admin.stats and admin revenue reports", () => {
  it("sums only 'paid' payments into revenueCents, excluding pending/refunded/failed", async () => {
    const admin = await insertUser({ email: "stat-admin@test.local", role: "admin" });
    const member = await insertUser({ email: "stat-member@test.local" });
    const plan = await insertPlan();
    const membership = await insertMembership(member.id, plan.id);

    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 10000, status: "paid" });
    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 20000, status: "paid" });
    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 99999, status: "pending" });
    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 99999, status: "failed" });
    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 99999, status: "refunded" });

    const stats = await callerAs(admin).admin.stats();
    expect(stats.revenueCents).toBe(30000);
    expect(stats.pendingPayments).toBe(1);
  });

  it("revenueByMethod groups and sums correctly, only over paid payments", async () => {
    const admin = await insertUser({ email: "method-admin@test.local", role: "admin" });
    const member = await insertUser({ email: "method-member@test.local" });
    const plan = await insertPlan();
    const membership = await insertMembership(member.id, plan.id);

    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 10000, method: "card", status: "paid" });
    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 5000, method: "card", status: "paid" });
    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 7000, method: "upi", status: "paid" });
    await insertPaidPayment({ userId: member.id, membershipId: membership.id, amountCents: 999999, method: "cash", status: "pending" });

    const rows = await callerAs(admin).admin.revenueByMethod();
    const card = rows.find((r) => r.method === "card");
    const upi = rows.find((r) => r.method === "upi");
    const cash = rows.find((r) => r.method === "cash");

    expect(card).toMatchObject({ totalCents: 15000, count: 2 });
    expect(upi).toMatchObject({ totalCents: 7000, count: 1 });
    expect(cash).toBeUndefined(); // only pending, never reaches the "paid" filter
  });

  it("refundCount reflects only payments with status 'refunded'", async () => {
    const admin = await insertUser({ email: "refcount-admin@test.local", role: "admin" });
    const member = await insertUser({ email: "refcount-member@test.local" });
    const plan = await insertPlan();
    const membership = await insertMembership(member.id, plan.id);

    const p1 = await insertPaidPayment({ userId: member.id, membershipId: membership.id, status: "paid" });
    await insertPaidPayment({ userId: member.id, membershipId: membership.id, status: "paid" });
    await callerAs(admin).payments.refund({ id: p1.id });

    const result = await callerAs(admin).admin.refundCount();
    expect(result.count).toBe(1);
  });

  it("rejects non-admin callers from every admin procedure", async () => {
    const member = await insertUser({ email: "notadmin@test.local", role: "member" });
    const trainer = await insertUser({ email: "nottrainer@test.local", role: "trainer" });

    await expect(callerAs(member).admin.stats()).rejects.toMatchObject({ message: "Admins only." });
    await expect(callerAs(trainer).admin.stats()).rejects.toMatchObject({ message: "Admins only." });
    await expect(callerAs(null).admin.stats()).rejects.toMatchObject({ message: "Sign in required." });
  });
});
