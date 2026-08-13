# FlexFit Studio

Class booking and membership management for a single gym site. Members book classes, buy memberships and spend class credits. Staff run the front desk, manage trainers and pull reports. Companies buy credit pools their employees book against.

## Requirements

Node 20 or newer, and pnpm. If you don't have pnpm:

```bash
npm install -g pnpm
```

The database is SQLite and lives in a file. There's no server to install and no account to create.

## Getting set up

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

That gets you a populated studio at http://localhost:3000 with a couple of weeks of classes either side of today.

`db:push` creates `flexfit.db` and applies the schema. `db:seed` fills it with sample members, plans, classes and bookings.

## Signing in

| Role    | Email                  | Password   |
| ------- | ---------------------- | ---------- |
| Admin   | admin@flexfit.test     | admin123   |
| Trainer | arjun@flexfit.test     | trainer123 |
| Member  | rahul.k@example.com    | member123  |

Every seeded member uses `member123`. The other member emails are in `src/db/seed.ts`.

## Commands

| Command         | What it does                                      |
| --------------- | ------------------------------------------------- |
| `pnpm dev`      | Development server on port 3000                    |
| `pnpm build`    | Production build                                   |
| `pnpm db:push`  | Apply the schema in `src/db/schema.ts`             |
| `pnpm db:seed`  | Wipe the data and reseed                           |
| `pnpm db:reset` | Delete the database file, then push and seed again |
| `pnpm test`     | Vitest — business logic, against its own seeded DB |
| `pnpm test:e2e` | Playwright — end-to-end flows, against its own dev server |

`db:reset` is the one you want when the data gets into a state you don't like. It's destructive and it's meant to be.

## Two things that will waste your time

Don't run `pnpm build` while `pnpm dev` is running. The build writes over the directory the dev server is using and the app starts throwing `MODULE_NOT_FOUND`. Nothing is actually broken. Stop the dev server, delete `.next`, start it again. If you want to typecheck while the server is up, use `npx tsc --noEmit` instead.

If you're changing anything in `src/db/schema.ts`, run `pnpm db:push` afterwards or the app and the database will disagree with each other in confusing ways.

## Layout

```
src/
  app/          routes and pages (Next.js App Router — folder structure here is the URLs)
  components/   shared, cross-page UI (e.g. NavBar)
  db/           schema, client, seed data
  lib/          generic helpers (formatting, password hashing, date math, tRPC client)
  features/     one folder per domain — each holds its tRPC router(s) plus any
                logic specific to that domain (e.g. features/bookings/shared.ts)
  server/       trpc.ts (context + procedure builders) and routers/_app.ts
                (combines every feature router into the app-wide API)
documents/      FEATURE_INVENTORY.md, DECISIONS.md, and other project notes
tests/          Vitest — business logic, against a real seeded SQLite file
e2e/            Playwright — end-to-end flows, against a dedicated seeded dev server
```
