# Schema delivery — how it actually works here

**Status of this folder: FROZEN as of 2026-07-21 (Dept Review V1 decision).**
The Drizzle migration chain (`0000` … `0005` + `_post.sql`) is kept internally
consistent — `npm run db:migrate` on an empty DB applies cleanly and re-running
it is idempotent (gap-scan H3 fixes: `0005` is journal-registered, `_post.sql`
DROP-IF-EXISTS's its triggers) — but it is **not the delivery path for new
schema work** and lags `database/schema.sql` (it has nothing after `0005`;
Dept Review V1's tables exist only in schema.sql + upgrades/).

## The canonical paths

| Goal | Do this |
|---|---|
| **Fresh database** (dev, QA, test, new prod) | `npm run db:setup` — applies `database/schema.sql` (complete: tables + triggers + views). Refuses a non-empty DB. |
| **Upgrade an existing database** (has data) | Run the numbered scripts in `database/upgrades/` that the DB hasn't had yet (tracker table in its README). Additive ALTERs only. |
| **Change the schema** (as a developer) | Edit `database/schema.sql` **and** the Drizzle TS schema (`src/db/schema/*`) **and** add a `database/upgrades/NNN_*.sql` script — all three, every time. |

## What NOT to do

- **Don't** run `drizzle-kit generate` — the snapshots stop at `0004`, so it
  will emit a huge, wrong diff. The journal is frozen; new work does not get
  Drizzle migrations.
- **Don't** run `db:setup` against a database with data "to sync it" — schema.sql
  starts with `DROP TABLE IF EXISTS`. The script now refuses, for good reason.
- **Don't** hand-edit a live DB without also writing the matching
  `database/upgrades/` script — the next environment needs it.
