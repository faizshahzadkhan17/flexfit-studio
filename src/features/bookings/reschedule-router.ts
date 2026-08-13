import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  reschedules,
  bookings,
  classes,
  memberships,
  type Booking,
  type GymClass,
} from "@/db/schema";
import { router, protectedProcedure, type Context } from "@/server/trpc";
import { hoursUntil } from "@/lib/time";

/**
 * Members may reschedule free of charge up to this many hours before the
 * original class starts. This is more generous than cancellation policy.
 */
export const FREE_RESCHEDULE_HOURS = 4;

type RescheduleCheck =
  | { valid: false; code: TRPC_ERROR_CODE_KEY; reason: string }
  | {
      valid: true;
      originalBooking: Booking;
      originalClass: GymClass;
      targetClass: GymClass;
      targetIsFull: boolean;
    };

/**
 * Every rule a reschedule must satisfy, shared between the `reschedule`
 * mutation and its `validateReschedule` read-only preview. Callers decide
 * what to do with a failure (throw vs. return a reason) and what to do on
 * success (write vs. just report `targetIsFull`).
 */
async function checkReschedule(
  db: Context["db"],
  userId: number,
  fromBookingId: number,
  toClassId: number,
): Promise<RescheduleCheck> {
  const originalRow = await db
    .select({ booking: bookings, cls: classes })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(eq(bookings.id, fromBookingId))
    .get();

  if (!originalRow) {
    return { valid: false, code: "NOT_FOUND", reason: "Booking not found." };
  }

  const originalBooking = originalRow.booking;
  const originalClass = originalRow.cls;

  if (originalBooking.userId !== userId) {
    return { valid: false, code: "FORBIDDEN", reason: "You cannot reschedule this booking." };
  }

  if (originalBooking.status !== "booked" && originalBooking.status !== "waitlisted") {
    return { valid: false, code: "BAD_REQUEST", reason: "This booking is no longer active." };
  }

  const hoursBeforeOriginal = hoursUntil(originalClass.startsAt);
  if (hoursBeforeOriginal < FREE_RESCHEDULE_HOURS) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: `You can only reschedule up to ${FREE_RESCHEDULE_HOURS} hours before the class starts.`,
    };
  }

  const targetClass = await db.select().from(classes).where(eq(classes.id, toClassId)).get();

  if (!targetClass) {
    return { valid: false, code: "NOT_FOUND", reason: "Target class not found." };
  }

  if (targetClass.name !== originalClass.name) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "You can only reschedule to a class with the same name.",
    };
  }

  if (targetClass.id === originalClass.id) {
    return { valid: false, code: "BAD_REQUEST", reason: "You are already booked for this class." };
  }

  if (hoursUntil(targetClass.startsAt) <= 0) {
    return { valid: false, code: "BAD_REQUEST", reason: "This class has already started." };
  }

  if (targetClass.cancelled) {
    return { valid: false, code: "BAD_REQUEST", reason: "This class has been cancelled." };
  }

  const existingBooking = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, targetClass.id),
        eq(bookings.userId, userId),
        sql`${bookings.status} in ('booked', 'waitlisted')`,
      ),
    )
    .get();

  if (existingBooking) {
    return {
      valid: false,
      code: "CONFLICT",
      reason: "You already have an active booking for this class.",
    };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(and(eq(bookings.classId, targetClass.id), eq(bookings.status, "booked")));

  const targetIsFull = Number(count) >= targetClass.capacity;

  return { valid: true, originalBooking, originalClass, targetClass, targetIsFull };
}

export const reschedulesRouter = router({
  reschedule: protectedProcedure
    .input(
      z.object({
        fromBookingId: z.number(),
        toClassId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const check = await checkReschedule(ctx.db, ctx.user.id, input.fromBookingId, input.toClassId);
      if (!check.valid) {
        throw new TRPCError({ code: check.code, message: check.reason });
      }
      const { originalBooking, originalClass, targetClass, targetIsFull } = check;

      // Create the new booking (don't charge credits, they keep what they spent)
      const newBooking = await ctx.db
        .insert(bookings)
        .values({
          classId: targetClass.id,
          userId: ctx.user.id,
          membershipId: originalBooking.membershipId,
          status: targetIsFull ? "waitlisted" : "booked",
          creditsUsed: originalBooking.creditsUsed, // Keep the same credits used
        })
        .returning()
        .get();

      // Cancel the original booking
      await ctx.db
        .update(bookings)
        .set({
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
        })
        .where(eq(bookings.id, originalBooking.id));

      // Record the reschedule
      await ctx.db.insert(reschedules).values({
        userId: ctx.user.id,
        fromBookingId: originalBooking.id,
        toBookingId: newBooking.id,
        fromClassId: originalClass.id,
        toClassId: targetClass.id,
      });

      return {
        ok: true,
        newBooking,
        newStatus: targetIsFull ? "waitlisted" : "booked",
      };
    }),

  history: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: reschedules.id,
        rescheduledAt: reschedules.rescheduledAt,
        fromClassName: classes.name,
        fromClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        fromClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        toClassName: sql<string>`(
          SELECT ${classes.name} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
      })
      .from(reschedules)
      .innerJoin(classes, eq(reschedules.fromClassId, classes.id))
      .where(eq(reschedules.userId, ctx.user.id))
      .orderBy(desc(reschedules.rescheduledAt));
  }),

  validateReschedule: protectedProcedure
    .input(
      z.object({
        fromBookingId: z.number(),
        toClassId: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const check = await checkReschedule(ctx.db, ctx.user.id, input.fromBookingId, input.toClassId);
      if (!check.valid) {
        return { valid: false, reason: check.reason };
      }
      return { valid: true, targetIsFull: check.targetIsFull };
    }),
});
