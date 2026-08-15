# FlexFit Studio — Decisions

Phase 4 write-up. Covers the folder structure chosen for the Phase 3 refactor,
alternatives considered, what was fixed vs. left alone and why, tradeoffs, and
current test/known-gap status. Read alongside [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md)
(the Phase 1 discovery) and [../AI_USAGE_LOG.md](../AI_USAGE_LOG.md) (the running
log of every AI-assisted change, dated).

---

## Folder structure

**Chosen:** feature-based, one folder per domain under `src/features/`, each
holding its tRPC router(s) plus any logic specific to that domain:

```
src/features/
  auth/router.ts
  bookings/router.ts            bookings/reschedule-router.ts   bookings/shared.ts
  classes/router.ts
  corporate/bookings-router.ts  corporate/companies-router.ts
  members/router.ts
  memberships/router.ts
  notifications/router.ts
  payments/router.ts
  reports/router.ts
  trainers/router.ts
src/server/
  trpc.ts                       context + procedure builders
  routers/_app.ts                combines every feature router into the app-wide API
src/lib/
  time.ts, password.ts, ...     generic, domain-agnostic helpers
```

**Why:** the app was previously a flat `src/server/routers/*.ts` — 12 files in
one folder with no grouping signal beyond the filename. A new engineer has to
open every file to learn which ones are related (e.g. that `reschedules.ts`
is really an extension of `bookings.ts`, or that `admin-companies.ts` and
`corporate-bookings.ts` are two halves of the same corporate-membership
feature). Grouping by domain makes that relationship visible in the directory
tree itself, which is the idiomatic pattern for tRPC + Next.js App Router
projects of this size — routers live next to the domain logic they expose,
and `_app.ts` stays a thin composition point.

Two domains got sub-grouping instead of a single file:
- `bookings/` holds both `router.ts` (book/cancel/list) and
  `reschedule-router.ts` (reschedule/validateReschedule) — related but large
  enough (384 + 231 lines) that merging them into one file would trade one
  kind of clutter for another.
- `corporate/` holds both `bookings-router.ts` (member-side booking against a
  company's credit pool) and `companies-router.ts` (admin-side company
  management) — same reasoning; they're one feature (corporate memberships)
  expressed as two audiences (member vs. admin) hitting two different data
  shapes.

## Alternatives considered

**A flatter/simpler structure** was the first thing proposed back to me
mid-Phase-3 (documented in [../AI_USAGE_LOG.md](../AI_USAGE_LOG.md), pass-1
entry) — essentially: don't sub-group `bookings/` and `corporate/`, keep one
router file per top-level domain only. Rejected in favor of the structure
above once we confirmed the sub-grouped files were both large enough on their
own (>200 lines each) that a single merged file per domain would just move
the "which part of this file am I in" problem from the directory tree into
the file itself.

**Colocating routers next to their pages** (e.g. `src/app/bookings/router.ts`
instead of `src/features/bookings/router.ts`) was not seriously pursued —
tRPC routers here are consumed by multiple pages each (e.g. `bookings.cancel`
is called from the dashboard, the waitlist page, and the reschedule modal),
so there's no single page that "owns" a router the way App Router colocation
assumes. Keeping `src/features/` separate from `src/app/` keeps that
many-to-many relationship honest instead of implying a 1:1 one that doesn't
exist.

## What was fixed vs. left alone, and why

**Fixed (pure internal restructuring, zero behavior change, each verified
against the full test suite before landing):**
- Moved all 12 routers into `src/features/<domain>/` (commit `410e449`) —
  import paths and `_app.ts` wiring updated; router keys and every procedure
  path unchanged.
- Deduplicated `hoursUntil()` (copy-pasted across 3 routers) into
  `src/lib/time.ts`, and `activeMembershipFor()` (copy-pasted across 2) into
  `src/features/bookings/shared.ts` (commit `cf61469`). Also removed a dead
  copy of `activeMembershipFor` found unused in `reschedules.ts` during that
  pass — deleted rather than pointed at the shared version, since nothing
  called it.
- Extracted the ~10 checks duplicated between `reschedule` (the mutation) and
  `validateReschedule` (its read-only preview) into one `checkReschedule()`
  helper returning a discriminated union (commit `5cc8720`). Same checks,
  same order, same error codes and messages — each procedure just decides
  what to do with the result now instead of repeating the logic.

**Deliberately left alone — 7 issues, all logged in
[FEATURE_INVENTORY.md](FEATURE_INVENTORY.md#-known-issues-found--documented-and-left-2026-08-13)
rather than fixed:**

| # | Issue | Why left alone |
|---|-------|-----------------|
| 1 | Admin class-cancel doesn't refund member or corporate credits | Touches credit-balance logic — flagged per the explicit rule, not fixed without direction |
| 2 | Admin class-cancel leaves waitlisted bookings stranded | Same code path as #1 |
| 3 | No notification ever sent for waitlist promotion / class cancel / membership expiry | Scope gap, not a correctness bug in what exists |
| 4 | Payment refund doesn't touch existing bookings/credits | Payment logic — flagged per the explicit rule, not fixed without direction |
| 5 | `no_show` status is never set by any live code path | Only reachable via seed data; no user-facing regression risk either way |
| 6 | Corporate check-ins undercounted in trainer's "checked in" card | Data-shape mismatch (`checkins.bookingId: null`), not something a folder refactor should silently paper over |
| 7 | `/schedule` and the reschedule modal never finish loading in a real browser (unmemoized timestamp recomputed every render) | Client-rendering bug found by Playwright during Phase 2, not Phase 1; document-and-leave decision confirmed same day it was found |

Rationale for leaving all seven: Phase 2's characterization tests
(36 Vitest + 14 Playwright) encode *today's* actual behavior, bugs included,
as the one stable baseline the Phase 3 refactor is checked against. Fixing
any of them mid-refactor would make a legitimate behavior change look like a
refactor regression in the test diff — the two need to stay separable. Two
of the seven (#1, #4) sit directly on credit/payment state, which is exactly
the category called out for extra caution; both are documented with enough
detail (reproduction steps, exact file/line) to be picked up as isolated,
individually-tested fixes later, on request.

## Tradeoffs

- **Sub-grouping `bookings/` and `corporate/` instead of one-file-per-domain**
  costs one extra level of directory nesting for those two domains, in
  exchange for keeping individual files under ~400 lines. Judged worth it;
  revisit if either grows enough to need three-way splitting instead.
- **Not fixing the 7 known issues now** means the app ships this hackathon
  submission with real bugs (most notably #1 and #4, which affect credit
  correctness). That's the deliberate cost of prioritizing "restructure
  without changing behavior" as stated in the goal — the alternative
  (fixing as we go) would have made it impossible to tell, from the test
  suite alone, whether a failure after a refactor pass was a mistake in the
  refactor or an intentional behavior change.
- **No structural split was done on the two largest remaining files**
  (`bookings/router.ts` at 384 lines, `reports/router.ts` at 268 lines).
  Neither was found to be doing two *unrelated* jobs on inspection — they're
  long because each procedure in them is a distinct, cohesive operation
  within one domain, not because two domains got jammed into one file. Left
  as-is rather than split for the sake of a line-count target; flag if a
  closer read turns up an actual seam.

## Known gaps (surfaced by a self-audit on 2026-08-14, before this file existed)

Running the actual test commands (not just trusting the log) and diffing
`AI_USAGE_LOG.md` against real commit history turned up two things worth
being upfront about, since criterion #2 is specifically about the paper
trail being real, not reconstructed:

- **This file didn't exist until 2026-08-14**, a day after the refactor
  commits (`410e449` through `8ad204e`) had already landed. Phase 4 was
  simply not reached before Phase 3 wrapped for the day.
- **`AI_USAGE_LOG.md` entries for the folder-reorg (`410e449`) and dedup
  (`cf61469`) commits were written and committed later, bundled into a
  third, unrelated commit (`5cc8720`)** rather than committed alongside
  their own change. The log's *content* is accurate to what happened, but
  its git history doesn't show it being written "as we go" for those two
  entries — a reviewer diffing commit-by-commit would see the log update
  arrive attached to the wrong commit. Additionally, commits `5cc8720`
  (the `checkReschedule()` extraction itself) and `8ad204e` (README update)
  have no log entry at all. Not corrected retroactively here — surfacing it
  is the more honest move than quietly rewriting commit history to look
  cleaner than it was; a follow-up commit can add the missing entries going
  forward if wanted.

## Test suite status (verified 2026-08-14)

- `pnpm test` (Vitest): **36/36 passing**
- `npx playwright test` (Playwright): **14/14 passing**
- `npx tsc --noEmit`: clean, no errors

All three re-run directly as part of this write-up, against the current
`main` branch, not carried forward from an earlier log entry.
