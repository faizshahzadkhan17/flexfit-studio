# FlexFit Studio — Feature Inventory

Compiled by reading `src/db/schema.ts`, all 12 tRPC routers under `src/server/routers/`,
and all 15 pages/components under `src/app` and `src/components`, then verified against
the running app (seeded dev DB, `pnpm dev`) via direct tRPC calls as admin, trainer, and
two member accounts. Every input/output/error documented below reflects what the code
and the running app actually do, not what the UI implies.

Key business constants (from source, not guessed):
- `FREE_CANCELLATION_HOURS = 12` — member booking cancellation refund window (`bookings.ts`)
- `CORPORATE_FREE_CANCELLATION_HOURS = 24` — corporate booking cancellation refund window (`corporate-bookings.ts`)
- `FREE_RESCHEDULE_HOURS = 4` — reschedule cutoff (`reschedules.ts`)
- `UNLIMITED_CREDITS = 999` — credit value treated as "unlimited," never decremented
- `SESSION_DAYS = 30` — login session lifetime

---

## ⚠️ Known issues found — documented and left (2026-08-13)

Per the rules of engagement, these were flagged rather than fixed. Decision (2026-08-13):
document all six, fix none during the refactor. Rationale: Phase 2's characterization tests
need a single stable baseline — today's actual behavior, bugs included — so a bug fix
mid-project wouldn't cause a false "regression" signal during Phase 3. Any fixes will be
revisited afterward as a separate, isolated, individually-tested change, not bundled into
the restructuring work. All six were confirmed by reproducing them against the live app,
not just read from source.

### Issue 1 — Cancelling a class does not refund credits (member or corporate)
`classes.cancel` (admin-only, `classes.ts:132`) sets the class `cancelled` flag and bulk-cancels
`bookings` rows with status `booked`, but never restores `creditsUsed` to the member's
membership. **Reproduced live**: member had 10 credits, booked a class (→ 9), admin cancelled
the class, member's booking flipped to `cancelled` but credits stayed at 9 — the credit is
gone with no recourse. The member-initiated cancellation path (`bookings.cancel`) *does*
refund correctly; this is specific to the admin bulk-cancel path. The same function never
touches the `corporateBookings` table at all, so a company's credit pool is never refunded
either, and corporate bookings for a cancelled class stay `booked` forever.

### Issue 2 — Cancelling a class leaves waitlisted bookings stranded
Same function only updates bookings with status `booked`; rows with status `waitlisted` for
that class are left untouched. **Reproduced live**: a waitlisted member's booking still shows
as `waitlisted` (with a queue position) for a class that is now cancelled — indefinitely,
until they notice and manually leave the waitlist themselves.

### Issue 3 — No notification is ever sent for waitlist promotion, class cancellation, or membership expiry
The `notifications` table's `type` enum includes `waitlist_promotion`, `class_cancelled`, and
`membership_expiring`, and `src/db/seed.ts` inserts one fake example of each so the
Notifications page has something to show in the demo. But no live code path ever creates
one: `bookings.cancel`'s waitlist-promotion logic doesn't notify the promoted member,
`classes.cancel` doesn't notify affected members, and there is no scheduled/triggered job
for expiring memberships. Only `notifications.broadcast` (admin announcements) is wired up
to actually insert rows during normal use. The bell icon and notifications page work
correctly for what does get inserted — the gap is that most of the schema's notification
types are effectively dead code.

### Issue 4 — Refunding a membership payment doesn't touch existing bookings or credits
`payments.refund` (admin-only) flips the membership's status to `cancelled` but leaves
`creditsRemaining` and any classes already booked against that membership completely
untouched. **Reproduced live**: refunded rahul's ₹3,500 Drop-in Pack payment — membership
status became `cancelled`, but he kept his 9 remaining credits and his active booking. A
refunded member can still attend classes they'd already booked. This is payment/credit
logic, so flagging per your explicit rule rather than touching it.

### Issue 5 — `no_show` booking status is never set by the running app
The `no_show` value exists in the `bookings.status` enum and `admin.noShowList` queries for
it, but the only place that ever writes `status: "no_show"` is `src/db/seed.ts` (fake demo
data). There is no mutation anywhere — kiosk, admin, or otherwise — that lets staff mark a
booking as a no-show. The Admin → Attendance page's "No-shows" panel will only ever show
seeded rows; in a real (unseeded) run it would always be empty.

### Issue 6 — Corporate check-ins are invisible to the trainer's "checked in" count
`corporateBookings.markAttended` inserts a `checkins` row with `bookingId: null` (it has no
member `bookings` row to point to). `bookings.checkinCountFor` — used by the trainer
schedule page to show "✓ N checked in" per class — does an inner join from `checkins` to
`bookings` on `bookingId`, which silently excludes any row with a null `bookingId`. Net
effect: corporate member check-ins happen and are recorded, but never counted on that card.

---

## Authentication & session

**Actor:** anyone (public), then member/trainer/admin once signed in
**Inputs:** email, password (login); email, password (min 6 chars), name, optional phone (register)
**Outputs:** httpOnly session cookie (`flexfit_session`, 30-day expiry), `{id, name, role}` on login
**Edge cases observed:**
- Wrong password and unknown email both return the identical message "Email or password is
  incorrect." (401 UNAUTHORIZED) — does not leak whether an account exists.
- Deactivated account (`users.active = false`) with correct credentials: "This account has
  been deactivated." (403 FORBIDDEN), checked *after* password verification.
- Registering with an email already in use: "An account with that email already exists."
  (409 CONFLICT). Email is lowercased/trimmed before the uniqueness check, so
  `Foo@Bar.com` collides with `foo@bar.com`.
- New registrations always get `role: "member"` — no way to self-register as trainer/admin.
- Passwords hashed with `scrypt` + per-user random salt, compared with `timingSafeEqual`
  (`src/lib/password.ts`) — reasonable, no issue found here.
- Logout deletes the session row server-side (not just the cookie), so a stolen cookie
  token can't be replayed after logout.
**Status:** unchanged

## Class schedule browsing

**Actor:** public (no login required)
**Inputs:** optional `from`/`to` ISO date filters, `includeCancelled` flag
**Outputs:** class list with computed `spotsLeft` and `full` flags per class
**Edge cases observed:**
- Cancelled classes are excluded by default; `includeCancelled` reveals them (used nowhere
  in the current UI, but the API supports it).
- "Booked" count only counts status `booked`, not `waitlisted` or `attended` — a class that's
  full still shows accurate `spotsLeft: 0` since bookings only reach "booked" up to capacity.
- Unauthenticated visitors see the full schedule but every "Book" button is disabled
  client-side (`disabled={!user}`); the server-side `book` mutation independently requires
  login anyway via `protectedProcedure`.
**Status:** unchanged

## Member: booking a class

**Actor:** member (or trainer/admin acting as themselves — no role restriction beyond login)
**Inputs:** `classId`
**Outputs:** created booking, status `booked` or `waitlisted`
**Edge cases observed (all reproduced live):**
- Class not found → 404 NOT_FOUND "Class not found."
- Class already cancelled → 400 BAD_REQUEST "This class has been cancelled."
- Class already started (`startsAt <= now`) → 400 BAD_REQUEST "This class has already started."
- Already booked or waitlisted for that class → 409 CONFLICT "You are already on the list for
  this class."
- No active membership (none, expired, or `endDate < today`) → 403 FORBIDDEN "An active
  membership is required to book classes."
- Active membership but insufficient credits (and not unlimited/999) → 403 FORBIDDEN "Not
  enough class credits remaining."
- Class at capacity → booking is still created, with status `waitlisted` and `creditsUsed: 0`
  — **no credit is charged while waitlisted**, confirmed live (credits only decrement on
  confirmed `booked` status).
- Unlimited-credit memberships (999) never decrement, confirmed by code and by the seed data
  pattern (`Monthly Unlimited` etc. all seed with 999).
**Status:** unchanged

## Member: cancelling a booking

**Actor:** booking owner, or any staff (admin/trainer) on someone else's booking
**Inputs:** `bookingId`
**Outputs:** `{ok: true, refunded: boolean}`
**Edge cases observed:**
- Booking not found → 404. Not the owner and not staff → 403 FORBIDDEN "You cannot cancel
  this booking." Booking already cancelled/attended/no-show → 400 BAD_REQUEST "This booking
  is no longer active."
- Refund only happens if cancelling ≥12 hours before class start **and** the booking had
  actually spent a credit (`creditsUsed > 0` — so cancelling a waitlisted spot, which never
  charged a credit, correctly reports `refunded: false` even though nothing was owed).
- Cancelling a confirmed (`booked`) spot triggers automatic promotion of the longest-waiting
  waitlisted booking for that class (ordered by `bookedAt` ascending — pure FIFO, no
  priority/seniority logic). The promoted booking is charged the class's credit cost at
  promotion time, capped at 0 via `Math.max` if the membership doesn't have enough (can leave
  a membership with negative... no — clamped to exactly 0, so a member could be promoted for
  "free" if they were short; documented under Issue-adjacent behavior, not flagged as a bug
  since it's clamped safely, just worth knowing).
- No notification is sent to the promoted member (see Issue 3).
**Status:** documented-and-left (Issue 3 — no promotion notification)

## Member: waitlist page

**Actor:** member
**Inputs:** none
**Outputs:** list of the member's own waitlisted bookings with computed `position` (1-indexed,
counting other waitlisted bookings for the same class with an earlier `bookedAt`)
**Edge cases observed:** leaving the waitlist reuses the same `bookings.cancel` mutation, so
all its edge cases apply. A class that gets cancelled by an admin while a member is
waitlisted still appears here indefinitely (Issue 2).
**Status:** documented-and-left (Issue 2)

## Member: rescheduling a booking

**Actor:** member (booking owner only — no staff override, unlike cancel)
**Inputs:** `fromBookingId`, `toClassId`
**Outputs:** new booking (status `booked` or `waitlisted` depending on target capacity),
original booking cancelled, a `reschedules` history row created
**Edge cases observed (validated via both `reschedule` and its parallel `validateReschedule`
read-only preview, which duplicate the same ~10 checks — a refactor candidate for later,
noted but not touched in Phase 1):**
- Not the booking owner → 403. Booking not active → 400. Less than 4 hours before the
  *original* class starts → 400 "You can only reschedule up to 4 hours before the class
  starts." (Note: this window is checked against the original class's start time, not the
  target's.)
- Target class must have the **exact same name** as the original ("You can only reschedule to
  a class with the same name.") — e.g. can reschedule "Sunrise Yoga" Tuesday → "Sunrise Yoga"
  Thursday, but not to a differently-named class even in the same room/slot.
- Target same as original class → 400. Target already started or cancelled → 400. Already has
  an active booking for the target class → 409.
- Credits are **not** re-charged on reschedule — `creditsUsed` carries over from the original
  booking to the new one, even if the target class has a different `creditCost` than the
  original. This means rescheduling from a 1-credit class into a 2-credit class only ever
  costs 1 credit (or into a 0-credit class still "costs" whatever was already paid). Flagging
  as an observed edge case, not a bug I'm classifying without your input — it's payment/credit
  adjacent, so I'm not touching it either way without your call.
**Status:** unchanged, credit-carryover behavior called out above for your awareness

## Membership plans & subscribing

**Actor:** public can browse; member (logged in) can subscribe
**Inputs:** `planId`, payment `method` (card/cash/upi/transfer, defaults to card)
**Outputs:** new `memberships` row (status `active`, credits = plan's `classCredits`,
`endDate` = today + plan's `durationDays`) and a `payments` row with status `paid` immediately
(no pending/approval step — subscribing always "succeeds" as a payment)
**Edge cases observed:**
- Plan not found → 404. Inactive plan (e.g. seeded "Legacy Founder Plan") → 400 "This plan is
  no longer available." — but inactive plans are already filtered out of `plans.list`'s
  default view, so this is only reachable by calling `subscribe` directly with a known-inactive
  plan ID.
- Subscribing again while already having an active membership: **allowed** — creates a second,
  independent `memberships` row. `members.profile` and `activeMembershipFor` always pick the
  one with the latest `endDate`, so the older membership's leftover credits become
  unreachable/orphaned rather than merged. Not flagging as a bug to fix (plausible this is
  intentional — no explicit "one membership at a time" rule exists anywhere), but noting it
  since it's credit-adjacent and worth your awareness.
**Status:** unchanged

## Member: dashboard (profile, membership summary, upcoming bookings, reschedule history)

**Actor:** member
**Inputs:** none (reads own data only)
**Outputs:** name, email, phone, role, current membership (or null), attended-class count,
upcoming bookings, reschedule history
**Edge cases observed:** no active membership renders "No active membership. Pick a plan to
start booking classes." instead of erroring. Credits display as "Unlimited" when ≥999.
**Status:** unchanged

## Payments (member view + admin operations)

**Actor:** member sees own payment history; admin sees all and can mark-paid / refund
**Inputs:** payment `id` (markPaid, refund)
**Outputs:** updated payment row
**Edge cases observed (live-tested):**
- `refund` only allowed on status `paid` → attempting to refund an already-refunded payment
  correctly returns 400 "Only paid payments can be refunded." (double-refund is blocked).
- `markPaid` blocked on status `refunded` → "Refunded payments cannot be marked paid." Calling
  `markPaid` on an already-`paid` payment is allowed and is a no-op status-wise (sets `paid` →
  `paid`) — harmless but slightly redundant; not flagging as a bug.
- Refund's interaction with existing bookings/credits is Issue 4 above.
**Status:** documented-and-left (Issue 4 — payment/credit logic, left untouched deliberately)

## Front desk / kiosk check-in

**Actor:** admin or trainer (staff)
**Inputs:** member search query (email or phone substring, 3+ chars), then `bookingId` +
check-in `source` (kiosk/front_desk/app)
**Outputs:** member lookup result, that member's bookings starting within the next 2 hours,
check-in confirmation
**Edge cases observed:**
- Lookup requires an **exact role match to `member`** — searching for a trainer's or admin's
  email/phone returns 404 "Member not found," even though `lookupByEmailOrPhone` matches
  partial email/phone substrings otherwise.
- `markAttended` only allows check-in for bookings currently `booked` (not `waitlisted`,
  `cancelled`, or already `attended`) → "Only confirmed bookings can be checked in."
- The kiosk UI disables the "Check in" button if the member's *most recent* membership
  (by `startDate`) is expired or has 0 credits remaining — but this is a **client-side-only**
  warning; the server-side `markAttended` mutation has no equivalent guard and doesn't
  re-verify credits or membership status at all (it just checks the booking is `booked`).
  This is consistent with credits already having been spent at booking time, so not flagging
  as a bug — but worth knowing the UI warning isn't backed by a server-side enforcement.
- There is no interface anywhere (kiosk or otherwise) for staff to book a class *on behalf of*
  a walk-in member — front desk can only check members into bookings that already exist.
  Noting as a scope observation, not a bug.
**Status:** unchanged

## Trainer: schedule & availability

**Actor:** trainer only (role-gated both client- and server-side)
**Inputs:** for availability: `dayOfWeek` (0–6), `startTime`, `endTime` (upsert per day)
**Outputs:** upcoming classes assigned to the trainer (with live roster/check-in counts per
class), weekly availability grid
**Edge cases observed:**
- `checkAvailability` (used for conflict-checking, e.g. when admin assigns a trainer to a new
  class — though no UI currently calls it) compares times as **UTC** hours/minutes
  (`getUTCHours`/`getUTCDay`), while availability is stored/edited as plain HH:MM strings
  entered in the browser's local time via `<input type="time">`. In any timezone other than
  UTC this produces incorrect availability/conflict results. Not exercised by any current page,
  but noting it since it's a latent bug if that procedure is ever wired into the UI.
- Per-class check-in counts undercount corporate attendees (Issue 6).
**Status:** documented-and-left (Issue 6, plus a latent UTC bug in `checkAvailability` noted
for awareness since it's currently unreachable from the UI)

## Admin/staff: class scheduling (create, update, cancel)

**Actor:** staff (admin or trainer) can create/update classes; only admin can cancel
**Inputs:** create — name, room, capacity, `startsAt`, optional description/trainerId,
optional durationMin/creditCost (default 60min/1 credit); update — `id` + any subset of
name/room/capacity/startsAt/trainerId; cancel — `id`
**Outputs:** created/updated class row; cancel returns the updated class row (bookings/credits
side effects are separate — see Issues 1 and 2)
**Edge cases observed (live-tested via a throwaway "QA Test Class", capacity 1):**
- `create` has no check preventing a past `startsAt`, an already-double-booked room/time, or
  a trainer double-booking (the `checkAvailability` conflict-checker exists but nothing calls
  it from this mutation) — a class can be created that immediately overlaps another. Not
  flagging as a bug to fix now (documented per the decision above), just noting the gap.
- `update` on a nonexistent `id` → 404 NOT_FOUND "Class not found." No validation stops
  shrinking `capacity` below the current number of confirmed bookings — existing `booked`
  rows aren't retroactively bumped to waitlisted if that happens.
- `cancel` on a nonexistent `id` → 404. Cancelling an already-cancelled class succeeds again
  as a no-op-ish update (still flips already-`true` `cancelled` to `true`, still re-runs the
  booking-cancellation bulk update, which is harmless the second time since there are no
  `booked` rows left to touch).
- The credit/waitlist/corporate-booking side effects of `cancel` are Issues 1 and 2 above.
**Status:** documented-and-left (Issues 1 and 2 apply to `cancel`)

## Admin: dashboard stats

**Actor:** admin only
**Inputs:** none
**Outputs:** total members, active memberships, upcoming classes, total revenue (sum of
`paid` payments), total check-ins, pending payment count
**Edge cases observed:** none beyond straightforward aggregation; all counts are simple SQL
aggregates with sensible `coalesce(...,0)` defaults for empty tables.
**Status:** unchanged

## Admin: reports (revenue by month/method, expiring memberships, refund count)

**Actor:** admin only
**Inputs:** none
**Outputs:** monthly and per-method revenue breakdowns (both only over `paid` payments —
refunded/pending excluded, so a refund reduces future totals but doesn't retroactively
subtract from the month it was originally paid in, since it's excluded from that group-by
entirely rather than net against the month), memberships expiring within 14 days, count of
refunded payments
**Edge cases observed:** "expiring" window is `[today, today+14]` inclusive on both ends —
a membership expiring exactly today still shows. No issues found.
**Status:** unchanged

## Admin: attendance (check-ins/day, top trainers, no-shows)

**Actor:** admin only
**Inputs:** none (fixed 14-day lookback)
**Outputs:** daily check-in counts, top 10 trainers by attended-class count over the window,
no-show list
**Edge cases observed:** see Issue 5 — the no-show panel is unreachable via any live user
action, only ever populated by seed data.
**Status:** documented-and-left (Issue 5)

## Admin: member management

**Actor:** admin (search/view is staff-level; activate/deactivate and role changes are
admin-only)
**Inputs:** search query (name/email substring), user `id` + `active` flag, or `id` + new
`role`
**Outputs:** filtered member list, member detail with membership history, updated user row
**Edge cases observed:**
- `setRole` has no restriction preventing an admin from demoting themselves or another admin,
  or promoting a member straight to `admin` — no confirmation, no audit trail. Not flagging as
  a bug (plausibly intentional for a small single-studio tool), just noting since role changes
  are a sensitive action with no guardrail.
- `byId` correctly strips `passwordHash` from the response before returning.
**Status:** unchanged

## Admin: announcements (broadcast notifications)

**Actor:** admin only
**Inputs:** title, message (free text, no length limit enforced server-side beyond
non-empty client-side)
**Outputs:** one `announcement`-type notification inserted per active member; returns count sent
**Edge cases observed:** if there are zero members, returns `{ok: true, count: 0}` without
error rather than doing a no-op insert. This is the **only** notification-generating path
that's actually wired up end-to-end (see Issue 3).
**Status:** unchanged

## Admin: corporate accounts (companies)

**Actor:** admin only
**Inputs:** company name/contact email/initial credit pool (create); `id` + `active` (toggle);
`id` + positive integer `amount` (top-up); `companyId` + `userId` (link member);
`companyMemberId` (unlink)
**Outputs:** company record, member list, recent corporate bookings (last 20)
**Edge cases observed:**
- Linking a non-member (trainer/admin) to a company → 400 "Only members can be linked to
  companies." Linking the same member to the same company twice → 409 CONFLICT.
- Deactivating a company does **not** retroactively affect existing corporate bookings or
  linked members — it only blocks *new* bookings, since `corporateBookings.book` checks
  `companies.active` via `getCompanyForMember`. Confirmed by reading the join condition; not
  independently re-verified live given time, but the logic is unambiguous.
- No lower bound stops `topUp` amount from being added to an inactive company's pool
  (`topUp` doesn't check `active`), which is a minor inconsistency but not user-facing harmful.
**Status:** unchanged

## Corporate member booking (parallel system to individual bookings)

**Actor:** member linked to an active company
**Inputs/outputs/edge cases:** structurally identical to the individual booking/cancel/waitlist
flow described above, but spends the **company's** shared `creditPoolBalance` instead of a
personal membership, with a longer 24-hour free-cancellation window (vs. 12 for individual).
Same waitlist-promotion-on-cancel logic, same FIFO ordering. Not required to have any personal
membership at all — corporate booking is entirely independent of the `memberships` table.
**Status:** documented-and-left (Issue 1 — class-cancel doesn't touch corporate bookings/pool at all)

---

## Environment note (not a feature, but relevant to how this was tested)

Something else — PID 16892, a Node process running since 2026-08-12 — is already bound to
port 3000 on this machine and answers with a broken 500 (a stale/crashed dev server, possibly
from a `E:\flexfit-studio-main` checkout, different from this `C:\...` one). I didn't touch it;
our dev server auto-selected port 3001 and all testing above was done against that. Flagging
in case you want it killed — I won't do that without you confirming, since it's an unfamiliar
process I didn't start.

---

## Summary

- 6 issues found, documented, and deliberately left unfixed (decision confirmed 2026-08-13).
  Two (Issues 1 and 4) touch credit/payment state directly and were treated as
  highest-caution throughout.
- Everything else observed behaves consistently with what the code says it should do; edge
  cases for errors, permissions, and state transitions were spot-checked live for the
  highest-risk flows (booking, waitlist promotion, class cancellation, payment refund) and
  matched source reading exactly except where an issue is called out above.
- Phase 2's characterization tests will encode today's actual behavior, including all six
  issues as-is, so the refactor has one stable, unambiguous baseline to protect. None of
  these six will be touched without a separate, explicit decision after the refactor lands.
