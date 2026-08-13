import { router } from "@/server/trpc";
import { authRouter } from "@/features/auth/router";
import { membersRouter } from "@/features/members/router";
import { plansRouter } from "@/features/memberships/router";
import { classesRouter } from "@/features/classes/router";
import { bookingsRouter } from "@/features/bookings/router";
import { paymentsRouter } from "@/features/payments/router";
import { adminRouter } from "@/features/reports/router";
import { notificationsRouter } from "@/features/notifications/router";
import { trainersRouter } from "@/features/trainers/router";
import { corporateBookingsRouter } from "@/features/corporate/bookings-router";
import { adminCompaniesRouter } from "@/features/corporate/companies-router";
import { reschedulesRouter } from "@/features/bookings/reschedule-router";

export const appRouter = router({
  auth: authRouter,
  members: membersRouter,
  plans: plansRouter,
  classes: classesRouter,
  bookings: bookingsRouter,
  reschedules: reschedulesRouter,
  corporateBookings: corporateBookingsRouter,
  payments: paymentsRouter,
  admin: adminRouter,
  adminCompanies: adminCompaniesRouter,
  notifications: notificationsRouter,
  trainers: trainersRouter,
});

export type AppRouter = typeof appRouter;
