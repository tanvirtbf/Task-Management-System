# MySQL → SQLite (Turso) + Express → Workers conversion rules

Project: `E:\Task Management System\astro-app` — an Astro + Cloudflare Workers port
of the Express/MySQL backend copied verbatim into `src/server/`. The original
(NEVER edit it) lives at `E:\Task Management System\server\src\`.

**Golden rule: minimal diffs.** Keep file structure, comments, names, export
shapes identical. Change only what the dialect/platform requires. TypeScript
must eventually pass `npx tsc --noEmit` from `astro-app/`.

---

## A. Drizzle SCHEMA conversion (`src/server/db/schema/*.ts`)

Import from `drizzle-orm/sqlite-core` instead of `drizzle-orm/mysql-core`.

| MySQL (old) | SQLite (new) |
|---|---|
| `mysqlTable(...)` | `sqliteTable(...)` |
| `varchar("c", { length: N })` / `char(...)` | `text("c")` |
| `mysqlEnum("c", values)` | `text("c", { enum: values })` |
| `boolean("c")` | `integer("c", { mode: "boolean" })` |
| `tinyint("c", …)` / `int(...)` / `smallint(...)` | `integer("c")` |
| `bigint("c", { mode: "bigint"/"number" })` (non-auto) | `integer("c", { mode: "number" })` |
| `timestamp("c")` | `timestampMs("c")` from `./_shared` |
| `.defaultNow()` | `.default(NOW_MS)` from `./_shared` |
| `.onUpdateNow()` | `.$onUpdate(() => new Date())` |
| `datetime(...)` | `timestampMs(...)` |
| `date("c", { mode: "string" })` | `text("c")` (ISO `YYYY-MM-DD`) |
| `date("c")` (Date mode) | `text("c")` + comment `// conv: was DATE(Date-mode)` — flag in your report |
| `time("c")` | `text("c")` |
| `json("c")` | `text("c", { mode: "json" })` — keep any `.$type<...>()` chained |
| `decimal("c", …)` | `numeric("c")` (string in/out, like mysql2) |
| `double`/`float` | `real("c")` |
| `mysqlSet("c", vals)` | unchanged (`_shared.ts` now emits TEXT) |
| `AnyMySqlColumn` | `AnySQLiteColumn` |
| `mysqlView(...)` | `sqliteView(...)` |
| `index`/`uniqueIndex`/`primaryKey`/`foreignKey`/`check` | same names from `sqlite-core`, same constraint names |
| `.references(() => x.id, { onDelete, onUpdate })` | unchanged |

**AUTO_INCREMENT:** SQLite only auto-increments `INTEGER PRIMARY KEY`. For a
table whose PK is a varchar `id` **plus** a separate `AUTO_INCREMENT` column
(e.g. `notifications.internal_id`): make the auto column the real PK —
`integer("internal_id", { mode: "number" }).primaryKey({ autoIncrement: true })`
— and demote `id` to `text("id").notNull().unique()`. Report every table where
you do this. If the auto column itself was the PK, it maps directly to
`integer("id", { mode: "number" }).primaryKey({ autoIncrement: true })`.

**Raw `sql` in defaults/checks:** translate MySQL functions per section C.
String-literal defaults like `sql\`'sun,mon,tue,wed,thu'\`` stay as-is.

**Views:** translate the SELECT body with section C's function map. Times are
stored as epoch **milliseconds**, DATE-only columns as ISO text.

**Type exports** (`$inferSelect` / `$inferInsert`) stay identical.

`relations.ts` is dialect-free — usually only imports need touching (if any).

## B. Drizzle QUERY/API conversion (repos, services)

| MySQL (old) | SQLite (new) |
|---|---|
| `.onDuplicateKeyUpdate({ set })` | `.onConflictDoUpdate({ target: [unique cols], set })` — target = the table's PK/unique constraint columns (check the schema file) |
| `sql\`VALUES(col)\`` inside upsert set | `sql\`excluded.col\`` |
| `insert(...).$returningId()` | `.returning({ id: table.id })` |
| `[result] = await db.insert(...)` + `result.insertId` | `.returning(...)` |
| `.for("update")` / `sql\`... FOR UPDATE\`` | remove (SQLite writes are serialized) |
| `db.transaction(async (tx) => …)` | unchanged |
| `import { MySql2Database } from "drizzle-orm/mysql2"` | `import { MySql2Database } from "../db/client"` (compat alias) |

## C. SQL function / expression map (raw `sql` templates)

Timestamps are INTEGER **epoch ms**; DATE-only columns are TEXT `YYYY-MM-DD`.

| MySQL | SQLite |
|---|---|
| `NOW()` / `UTC_TIMESTAMP()` / `CURRENT_TIMESTAMP` (vs a timestamp col) | `(cast(unixepoch('subsec') * 1000 as integer))` |
| `CURDATE()` / `UTC_DATE()` (vs a DATE text col) | `date('now')` |
| `DATE_ADD(x, INTERVAL n DAY)` on ms col | `(x + n * 86400000)` |
| `DATE_ADD(x, INTERVAL n HOUR/MINUTE)` on ms col | `(x + n * 3600000)` / `(x + n * 60000)` |
| `DATE_ADD(x, INTERVAL n DAY)` on DATE text col | `date(x, '+n day')` |
| `DATE_SUB` | same patterns, negative |
| `DATE(ts_col)` (ms col → date) | `date(ts_col / 1000, 'unixepoch')` |
| `DATEDIFF(a, b)` | `(julianday(a) - julianday(b))` with appropriate conversions |
| `CONCAT(a, b, …)` | `(a \|\| b \|\| …)` |
| `IFNULL` / `COALESCE` / `GROUP_CONCAT` / `json_extract` | unchanged |
| `JSON_ARRAYAGG(x)` | `json_group_array(x)` |
| `JSON_OBJECT(...)` | `json_object(...)` |
| `TRUE` / `FALSE` literals | `1` / `0` |
| `RAND()` | `(abs(random()) / 9223372036854775807.0)` |
| `LAST_INSERT_ID()` | use `.returning()` instead |
| `INSERT IGNORE` | `insert().onConflictDoNothing()` |
| `MATCH ... AGAINST` (fulltext) | `LIKE '%…%'` fallback (flag it in your report) |
| `BINARY x = y` (case-sensitive cmp) | plain `x = y` (SQLite is case-sensitive by default) |

**Case-insensitivity warning:** MySQL string equality was case-INsensitive.
Where the code compares emails/slugs from user input with `eq()`, that now
becomes case-sensitive on SQLite. Do not blanket-change; just REPORT any spot
where this could break login/lookup flows.

## D. Platform (Workers) rules

- No Node-only libs: `bcrypt`, `nodemailer`, `winston` (runtime), `@aws-sdk/*`,
  `mysql2`, `fs` are gone. `node:crypto` (createHash/createHmac/randomBytes/
  createCipheriv), `Buffer`, `process.env` ARE available (nodejs_compat).
- `express` resolves to the shim at `src/server/shim/express.ts` at runtime;
  types still come from @types/express — do not change express-style code.
- Config (`src/server/config/index.ts`) is a lazy getter object — same keys as
  before plus `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`; DB_* MySQL keys are gone.
- Logger (`src/server/config/logger.ts`) is console-backed, typed as winston
  `Logger`. Import sites stay unchanged.
- DB client (`src/server/db/client.ts`): `initDb`/`getDb` unchanged;
  `getPool()` now throws (only used inside a guarded metrics gauge).

## E. Verification for every edited file

Run from `astro-app/`:
```
npx tsc --noEmit 2>&1 | grep -F "<your-file>"
```
Zero errors for YOUR files (other files may still be red — ignore them).
Never edit files outside your assigned list; report cross-file issues instead.
