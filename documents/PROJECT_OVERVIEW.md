# FlexFit Studio — Project Overview

**2026 i12 HR Drive Hackathon (Callus) submission.** This is the single document that
ties everything else together — the full story from the codebase we were handed to
where things stand right now, folder by folder, commit by commit, tool by tool. The
other three documents in this folder go deeper on their own slice; this one is the map.

---

## 1. What FlexFit Studio is

A class-booking and membership-management app for a single gym site. Members book
classes and spend class credits; staff run the front desk and check members in;
admins manage trainers, classes, memberships, and revenue reporting; companies buy
credit pools their employees book against. Single-tenant, no multi-gym support, SQLite
as the only datastore — deliberately small in scope.

## 2. Tech stack

| Layer | Tool | Version |
|---|---|---|
| Framework | Next.js (App Router) | ^15.1.0 |
| UI | React | ^19.0.0 |
| API layer | tRPC (client + server + react-query) | ^11.0.0 |
| Data fetching | TanStack React Query | ^5.62.0 |
| ORM | Drizzle ORM + drizzle-kit | ^0.38.0 / ^0.30.0 |
| Database | SQLite via @libsql/client | ^0.14.0 |
| Validation | Zod | ^3.24.1 |
| Styling | Tailwind CSS | ^3.4.17 |
| Language | TypeScript | ^5.7.2 |
| Unit/integration tests | Vitest | ^2.1.8 |
| End-to-end tests | Playwright | ^1.62.1 |
| Package manager | pnpm | — |

No auth-as-a-service, no external APIs, no paid infrastructure — everything runs
locally against a file-based SQLite database. This matters for the discovery
work below: there was no external system to inspect, only the code and the running app.

---

## 3. What we were handed (the starting point)

The repo did **not** start empty. Before any hackathon-labeled work began, it already
had **8 commits** building a working app with no documentation, no tests, and no
written spec of its own behavior — that gap is the actual assignment.

| Commit | What it added |
|---|---|
| `e95e44f` | Initial build: schema, seed data, auth, admin, bookings, classes, members, payments, plans routers, schedule page, NavBar |
| `c311f27` | Notifications + admin announcements |
| `7b4a4cd` | Trainer availability + admin revenue reports |
| `5475556` | Kiosk check-in + attendance view |
| `b0af75b` | Corporate memberships and class packs |
| `4425b7b` | Self-serve reschedule + waitlist page |
| `9d27aea` | Empty `documents/` folder (placeholder) |
| `c33f54c` | README with setup instructions |

At that point: ~5,400 lines across ~40 files, all 12 tRPC routers flat in one
`src/server/routers/` folder, zero tests, zero characterization of what the app
actually does versus what it was supposed to do. That's the "unfamiliar codebase"
this hackathon is about — nobody on this side of the assignment wrote the original
app, which is why Phase 1 below was a real investigation, not a formality.

---

## 4. The assignment, in short

Restructure the codebase into something a new engineer would want to work in —
**without changing any observable behavior** — for every existing feature. No spec
existed, so the process was mandated as four phases:

1. **Discover** — run the app as every role, document every flow, every edge case
2. **Build a safety net** — characterization tests against current (possibly buggy) behavior
3. **Refactor** — reorganize and deduplicate, re-running the full suite after every pass
4. **Write up** — the folder structure chosen, why, and what was fixed vs. left alone

Alongside that, a fixed set of **rules of engagement** applied throughout: explain any
multi-file change before making it; never touch payment/refund/credit logic without
flagging the risk first; commit in small reviewable increments; never silently fix a
bug — flag it and wait; log every nontrivial AI-assisted change to `AI_USAGE_LOG.md`;
never do anything irreversible (deletes, force-pushes, dropped data) without asking
first. Those rules are why almost every step below has a "flagged, asked, then acted"
shape instead of just "did it."

---

## 5. Repository map — every folder and what's in it

```
flexfit-studio-main/
├── src/
│   ├── app/            18 files, 1,891 lines — Next.js App Router pages (routes)
│   ├── components/      2 files,   260 lines — shared cross-page UI
│   ├── db/               3 files,   628 lines — schema, client, seed data
│   ├── features/        13 files, 2,375 lines — one folder per domain (see below)
│   ├── lib/               4 files,    53 lines — generic, domain-agnostic helpers
│   └── server/            2 files,    88 lines — trpc context + app router composition
├── tests/                10 files                — Vitest, business-logic characterization
├── e2e/                    8 files                — Playwright, end-to-end flows
├── documents/              4 pairs (.md + .pdf)    — this doc's neighbors
├── AI_USAGE_LOG.md                                — dated log of every AI-assisted change
└── README.md                                      — setup/run instructions
```

### `src/app/` — routes (the URLs)
Next.js App Router: folder structure *is* the routing. `dashboard/`, `login/`,
`plans/`, `schedule/`, `waitlist/`, `kiosk/`, `notifications/`, `trainer/schedule/`,
`admin/` (with `attendance/`, `announcements/`, `companies/`, `reports/` inside it),
and `api/trpc/[trpc]/route.ts` — the single HTTP entry point tRPC mounts onto.

### `src/components/` — shared UI
Just two files: `NavBar.tsx` (role-aware navigation) and `reschedule-modal.tsx`
(the reschedule dialog used from the dashboard). Everything else is page-local.

### `src/db/` — data layer
`schema.ts` (Drizzle table definitions — users, memberships, plans, classes,
bookings, payments, companies, corporate bookings, checkins, notifications,
reschedules), `index.ts` (the libSQL client), `seed.ts` (demo data generator —
16 users, 6 plans, 96 classes, ~791 bookings when seeded).

### `src/features/` — the domain routers (post-refactor structure)
One folder per business domain, each holding its tRPC router(s):

| Folder | Contents |
|---|---|
| `auth/` | login, register, logout, session |
| `bookings/` | book, cancel, list (`router.ts`); reschedule, validateReschedule (`reschedule-router.ts`); `shared.ts` — deduplicated helpers |
| `classes/` | create, update, cancel, list |
| `corporate/` | member-side booking against a company pool (`bookings-router.ts`); admin-side company management (`companies-router.ts`) |
| `members/` | profile, search, activate/deactivate, role changes |
| `memberships/` | plan list, subscribe |
| `notifications/` | list, mark-read, admin broadcast |
| `payments/` | markPaid, refund |
| `reports/` | admin dashboard stats, revenue/attendance reports |
| `trainers/` | schedule, availability |

### `src/lib/` — generic helpers
`format.ts` (currency/date display), `password.ts` (scrypt hashing), `time.ts`
(`hoursUntil()` — deduplicated here in the refactor), `trpc.ts` (client setup).

### `src/server/`
`trpc.ts` — context creation and procedure builders (`publicProcedure`,
`protectedProcedure`, role-gated variants). `routers/_app.ts` — combines every
feature router into the one app-wide API surface.

### `tests/` and `e2e/`
Covered in detail in Section 7 (Phase 2). Short version: 36 Vitest tests against a
real seeded SQLite file (not mocks), 14 Playwright specs driving a real browser
against a dedicated dev server.

### `documents/`
`FEATURE_INVENTORY.md`/`.pdf` (Phase 1 output — every flow, every edge case, every
bug found), `DECISIONS.md`/`.pdf` (Phase 4 output — folder structure rationale,
what was fixed vs. left, tradeoffs), and this file.

---

## 6. What we actually did — phase by phase

### Phase 1 — Discover (2026-08-13)

Read `schema.ts`, all 12 original routers, and all 15 pages/components end to end.
Then ran the app for real: `pnpm install`, `pnpm db:push`, `pnpm db:seed`, `pnpm dev`,
and exercised booking, cancelling, waitlisting, refunding, and admin class-cancellation
live via direct tRPC calls as an admin and two separate member accounts — not just
reading source and assuming it matched runtime behavior.

**Output:** `documents/FEATURE_INVENTORY.md` — every feature documented as
Actor / Inputs / Outputs / Edge cases / Status. **Six real issues were found in this
pass alone**, each reproduced live (not just spotted in source), and none were fixed —
per the "flag, don't silently fix" rule, they were written up and a decision was
requested before touching anything.

### Phase 2 — Build the safety net (2026-08-13)

Two sub-passes:

**Vitest.** Set up against a real seeded SQLite file via `drizzle-kit push` in a
global test setup (not a hand-copied schema, so schema drift can't silently break the
tests), calling routers directly through tRPC's `createCaller` rather than mocking
anything. **36 tests across 6 files**, covering credit deduction, unlimited-plan
handling, FIFO waitlist promotion, refund-window boundaries, reschedule credit
carryover, corporate credit pools, payment refund/double-refund guards, and admin
revenue aggregation — including tests that intentionally assert the *current buggy*
behavior of Issues 1 and 2, so a later refactor pass can't silently change it without
a test failing.

**Playwright.** End-to-end coverage of the flows found in Phase 1: auth, member
booking/cancel/waitlist, kiosk check-in, admin reports/companies. Setting these up
is what surfaced **Issue 7** — a real client-side rendering bug (`/schedule` and the
reschedule modal never finish loading in a real browser, because they recompute
`new Date().toISOString()` on every render, which changes the React Query cache key
every render) that neither source-reading nor curl-based API testing in Phase 1 could
have caught, because it only exists in the browser's re-render behavior. Flagged,
and a decision (document-and-leave) was confirmed the same day.

**Result: 36/36 Vitest + 14/14 Playwright passing against the current, unmodified app** —
the stable baseline the refactor was checked against from here on.

### Phase 3 — Refactor (2026-08-13)

Three small, separately-verified passes — full test suite re-run after each one,
zero tolerance for a failing test being treated as anything other than a stop signal:

1. **`410e449`** — moved all 12 routers from a flat `src/server/routers/` into
   `src/features/<domain>/`, one folder per business domain (see Section 5). Only
   import paths changed; router keys and every procedure path stayed identical.
2. **`cf61469`** — deduplicated `hoursUntil()` (copy-pasted across 3 routers) into
   `src/lib/time.ts`, and `activeMembershipFor()` (copy-pasted across 2) into
   `src/features/bookings/shared.ts`. Found and removed one dead copy of
   `activeMembershipFor` along the way (defined, never called).
3. **`5cc8720`** — `reschedule` and its read-only preview `validateReschedule`
   duplicated the same ~10 validation checks end to end; extracted into one
   `checkReschedule()` helper returning a discriminated union.

Each pass: `tsc --noEmit` clean, then full Vitest (36/36) and Playwright (14/14) —
verified, not assumed, before moving to the next pass.

### Phase 4 — Write-up

This is the one phase that slipped: the refactor commits landed on 2026-08-13, but
`documents/DECISIONS.md` didn't get written until 2026-08-14, a day later, during a
self-audit that was run specifically to check the repo against this exact brief.
That audit (documented in `AI_USAGE_LOG.md`) also found that two `AI_USAGE_LOG.md`
entries had been written and committed later than their actual commits, bundled into
an unrelated later commit — a real gap against "logged as we go," disclosed rather
than quietly fixed by rewriting history. `DECISIONS.md` now covers the folder
structure and why, alternatives considered, the fixed-vs-left-alone table for all
7 issues, tradeoffs, and that gap itself.

### After Phase 4 — polish (2026-08-15)

Two more rounds, both user-directed:

- **Docs as PDF.** Built a small one-off markdown-to-HTML converter plus a print
  stylesheet (cover page, color-coded status badges, highlighted issue callouts),
  rendered through headless Chrome. Verified the conversion mechanically — all 19
  `**Status:**` fields in `FEATURE_INVENTORY.md` converted to badges, tag counts
  balanced — rather than trusting it by eye, and caught two real conversion bugs in
  the process (unhandled single-asterisk italics; a list-continuation bug that
  swallowed a `Status:` line immediately following a bullet list).
- **Cleanup.** Surveyed the repo for anything messy. Found no dead code or leftover
  files from the refactor in `src/` — the one dead function was already removed in
  `cf61469`. What was there was local build/cache output (`.next/`,
  `tsconfig.tsbuildinfo`, `test-results/`), a redundant tracked `documents/.gitkeep`,
  local SQLite databases, and Claude Code's own local permission-cache folder
  (`.claude/`). Presented all four categories and asked before deleting anything —
  local databases were explicitly left alone since deleting them is "dropping data"
  under the rules of engagement, even though they're regenerable.

---

## 7. Every commit, in order

| Commit | Message | Category |
|---|---|---|
| `e95e44f` | Initial FlexFit Studio build | pre-existing baseline |
| `c311f27` | Add notifications + admin announcements | pre-existing baseline |
| `7b4a4cd` | trainer availability + admin revenue reports | pre-existing baseline |
| `5475556` | kiosk check-in + attendance view | pre-existing baseline |
| `b0af75b` | Corporate memberships and class packs | pre-existing baseline |
| `4425b7b` | self-serve reschedule + waitlist page | pre-existing baseline |
| `9d27aea` | Add documents folder | pre-existing baseline |
| `c33f54c` | Add README with setup instructions | pre-existing baseline |
| `cec998b` | docs: add Phase 1 feature inventory from discovery pass | Phase 1 |
| `632237c` | docs: record decision to document-and-leave all Phase 1 issues | Phase 1 |
| `465307a` | test: add Vitest characterization tests for booking/credit/revenue logic | Phase 2 |
| `de0750e` | test: add Playwright e2e specs for core user flows | Phase 2 |
| `410e449` | refactor: reorganize tRPC routers into feature-based folders | Phase 3 |
| `cf61469` | refactor: deduplicate hoursUntil and activeMembershipFor | Phase 3 |
| `5cc8720` | refactor: extract shared validation from reschedule/validateReschedule | Phase 3 |
| `8ad204e` | docs: update README layout/commands for the new features/ structure | Phase 3 |
| `850dccc` | chore: remove documents/.gitkeep | post-Phase-4 cleanup |

**Pending (written, not yet committed as of this writing):** `documents/DECISIONS.md`,
`documents/DECISIONS.pdf`, `documents/FEATURE_INVENTORY.pdf`, an updated
`AI_USAGE_LOG.md`, and this file. Held back deliberately so they can be reviewed
before landing, per the "don't execute silently" rule.

---

## 8. Every issue identified — condensed

Full reproduction steps, exact file/line, and rationale live in
`FEATURE_INVENTORY.md`. This is the scoreboard:

| # | Issue | Touches credit/payment? | Status |
|---|---|---|---|
| 1 | Admin class-cancel doesn't refund member or corporate credits | **Yes** | documented-and-left |
| 2 | Admin class-cancel leaves waitlisted bookings stranded | No | documented-and-left |
| 3 | No notification ever sent for waitlist promotion / class-cancel / membership-expiry | No | documented-and-left |
| 4 | Payment refund doesn't touch existing bookings/credits | **Yes** | documented-and-left |
| 5 | `no_show` booking status never set by any live code path | No | documented-and-left |
| 6 | Corporate check-ins undercounted in trainer's "checked in" card | No | documented-and-left |
| 7 | `/schedule` and the reschedule modal never finish loading in a real browser | No | documented-and-left |

All seven were found, reproduced, and left exactly as-is — not fixed — so that the
Phase 2 test suite has one unambiguous, stable baseline to check the refactor against.
Issues 1 and 4 sit directly on credit/payment state, which is why they're marked
separately: those are the two where the rules of engagement required flagging the
risk explicitly before even considering a change, and neither has been touched.

---

## 9. Tools used, and how

- **Claude Code** — acting as engineering collaborator throughout: read the original
  codebase, ran it locally, wrote the characterization tests, performed the refactor
  passes, wrote all four `documents/` files, and built the markdown→PDF pipeline.
  Every nontrivial action is logged with date, what was asked, what was done, and
  whether it was accepted as-is, modified, or rejected, in `AI_USAGE_LOG.md`.
- **Vitest** — business-logic tests via tRPC's `createCaller`, against a real
  seeded SQLite file rather than mocks, so the tests exercise actual Drizzle queries.
- **Playwright** — full-browser end-to-end tests; this is what caught Issue 7, a bug
  invisible to both source-reading and API-level testing.
- **Drizzle Kit** (`drizzle-kit push`) — used in test setup to apply the real schema
  before each suite run, so schema drift shows up as a test failure, not silently.
- **git** — every refactor pass is its own small commit with its own message;
  nothing destructive (`reset --hard`, force-push, history rewrite) was used anywhere
  in this process, including when a documentation gap was found — it was disclosed
  in `DECISIONS.md` rather than fixed by rewriting commits.
- **Headless Chrome** (`chrome --headless --print-to-pdf`) — renders the two
  hand-styled HTML versions of `FEATURE_INVENTORY.md`/`DECISIONS.md` into the PDFs
  in `documents/`. The `.md` files remain the actual source of truth (diffable in
  git); the PDFs are a generated, easier-to-read export.

---

## 10. Where things stand right now (2026-08-15)

- **Tests:** 36/36 Vitest passing, 14/14 Playwright passing, `tsc --noEmit` clean —
  all verified by actually running them, not inferred from the log.
- **Committed:** everything through Phase 3, the README update, and the
  `documents/.gitkeep` cleanup (17 commits total, `main` branch).
- **Not yet committed:** `documents/DECISIONS.md` + its PDF, `documents/FEATURE_INVENTORY.pdf`,
  the current `AI_USAGE_LOG.md` edits, and this overview — all sitting in the working
  tree, waiting on review before anything is pushed.
- **Known documentation gap (disclosed, not hidden):** two `AI_USAGE_LOG.md` entries
  for earlier commits were written later than they should have been, bundled into an
  unrelated commit. Recorded in `DECISIONS.md` rather than silently corrected.
- **Known app bugs:** all 7, still open, all deliberately left for a future,
  isolated, individually-tested fix — not part of this restructuring effort.
- **Behavior change from the refactor:** none detected — the full characterization
  suite (Vitest + Playwright) passes identically before and after every Phase 3 pass.

---

## 11. Which document answers which question

| Question | Document |
|---|---|
| What does the app actually do, feature by feature? | `FEATURE_INVENTORY.md` |
| What bugs exist, and why weren't they fixed? | `FEATURE_INVENTORY.md` — "Known issues" section |
| Why is the code organized this way? What was fixed vs. left alone? | `DECISIONS.md` |
| What happened, in order, and what did the AI actually do at each step? | `AI_USAGE_LOG.md` |
| How do I run this thing? | `README.md` |
| I want the whole picture in one read | this file |

---

## 12. Appendix

**Seeded sign-in credentials** (from `src/db/seed.ts`, dev/test only):

| Role | Email | Password |
|---|---|---|
| Admin | admin@flexfit.test | admin123 |
| Trainer | arjun@flexfit.test | trainer123 |
| Member | rahul.k@example.com | member123 |

**Key business constants** (from source):
`FREE_CANCELLATION_HOURS = 12`, `CORPORATE_FREE_CANCELLATION_HOURS = 24`,
`FREE_RESCHEDULE_HOURS = 4`, `UNLIMITED_CREDITS = 999`, `SESSION_DAYS = 30`.

**Commands:**

```
pnpm install       install dependencies
pnpm db:push       apply src/db/schema.ts to flexfit.db
pnpm db:seed       wipe and reseed demo data
pnpm db:reset      delete flexfit.db, then push + seed
pnpm dev           dev server on :3000
pnpm build         production build
pnpm test          Vitest (business logic)
pnpm test:e2e      Playwright (end-to-end)
```
