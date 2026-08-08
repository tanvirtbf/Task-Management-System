# F6 — The route → permission map (F7's execution contract)

**Generated:** 2026-08-04 · **Inputs:** `route-census.json` (181 routes, re-runnable via
`route-census.ts`) · the P5 two-pass enforcement probe · `rbac/bootstrap.ts` (the seeded grant
matrix, snapshot-test-pinned) · the legacy checks read from every affected service.
**D3 is answered: gate all 21. No new permission keys are invented (catalog invariant #1).**

---

## 0. The census, reconciled to the catalog

```
181 routes total:  61 gated by requirePermission (27 distinct keys)
                  104 authenticate-only
                   16 public (auth, public forms, health)
```

29 catalog keys have no *route* gate. That number decomposes exactly — and only the first group is
F7's job:

| group | keys | disposition |
|---|---|---|
| **The 21 NOT ENFORCED** (ISS-024, D3) | listed in §1 | **F7 gates them** |
| Service-enforced already (P5: custom 403 codes) | `review.read`, `report.generate`, `report.note` | leave — already real |
| Enforced by the visibility machinery | `space.view`, `task.view` | leave — `rbac/scope.ts` / `ownEscape.ts` |
| Unresolved by testing (fixtures blocked) | `review.perform`, `form.view_submissions` | `form.view_submissions` gets its route gate in F7 (§1.17); `review.perform` left to its service (see §4) |
| **Catalog-invariant violation** (bonus row) | `space.head_assign` | **F7 fixes it** — §2.6; the key exists in catalog+seed and is checked NOWHERE |

## 1. The 21, one by one — route gates (the mechanical 15)

Legend: **seeded** = which bootstrap roles hold the key today (`E`=everyone incl. guest, `M`=member+,
`A`=admin+, `O`=owner). In every row below the seeded grant already reproduces today's effective
behaviour, so **F7 needs zero grant changes** — verified per key against the legacy checks.

| # | key | add `requirePermission` to | today | seeded |
|---|---|---|---|---|
| 1 | `member.view` | `GET /users` · `GET /users/:id` | any member | E ✓ |
| 2 | `task.create` | `POST /tasks` | any member | E ✓ |
| 3 | `task.edit` | `PATCH /tasks/:id` · `POST /tasks/bulk` | any member | E ✓ |
| 4 | `task.assign` | `POST /tasks/:id/assignees` · `DELETE /tasks/:id/assignees/:userId` | any member | E ✓ |
| 5 | `task.archive` | `POST /tasks/:id/archive` · `POST /tasks/:id/unarchive` | any member | E ✓ |
| 6 | `task.delete` | `DELETE /tasks/:id` (the soft path; the hard branch is §2.2) | any member | E ✓ |
| 7 | `comment.create` | `POST /tasks/:id/comments` | any member | E ✓ |
| 8 | `checklist.manage` | the 8 write routes: `POST /tasks/:id/checklists` · `PATCH /checklists/:id` · `DELETE /checklists/:id` · `POST /checklists/:id/items` · `POST /checklists/:id/items/bulk` · `PATCH /checklist-items/:id` · `POST /checklist-items/:id/toggle` · `DELETE /checklist-items/:id` | any member | E ✓ |
| 9 | `attachment.upload` | `POST /uploads/sign` · `POST /attachments/:id/finalize` · `POST /tasks/:id/attachments` | member+ (guests blocked by `Roles.GUEST` checks in `AttachmentsService:108,186` — **keep those**, compose) | M ✓ |
| 10 | `dependency.manage` | `POST /task-dependencies` · `DELETE /task-dependencies/:id` | any member | E ✓ |
| 11 | `customfield.set_value` | `PUT /tasks/:id/custom-fields/:fieldId` · `DELETE …` (same) | any member | E ✓ |
| 12 | `template.apply` | `POST /templates/:id/apply` | any member | E ✓ |
| 13 | `sprint.assign_tasks` | `POST /sprints/:id/tasks` · `DELETE /sprints/:id/tasks/:taskId` | any member (P28: even guests) | E ✓ |
| 14 | `bug.report` | `POST /eng/report-bug` | any member | E ✓ |
| 15 | `postmortem.manage` | `POST /eng/incidents/:id/postmortem` (the GET stays a read) | any member (P29: even guests) | E ✓ |
| 16 | `activity.view` | `GET /activity` · `GET /activity/recent` | any member | E ✓ |
| 17 | `form.view_submissions` | `GET /forms/:id/submissions` | any member (endpoint 500s in dev until F17/ISS-025 — the gate installs regardless) | E ✓ |

*(17 rows because `form.view_submissions` joins the mechanical batch; #18–22 below are the
service-shaped remainder of the 21 + the bonus row.)*

## 2. The service-shaped six — compose, per branch

**The compose rule (sub-decision settled here, per the plan's recommendation):** feature-logic
branches (self / author / uploader / department-head) are **not** role hierarchy and stay untouched;
the **admin/owner branch** of each legacy check becomes `legacyAdmin && holds(key)`. Consequences:
seeded roles behave exactly as today (admins hold every one of these keys); **un-ticking the toggle
now takes real effect** (D3's requirement); granting the key to a non-admin custom role does
**nothing** — compose cannot widen access, which is exactly why it was recommended over replace.
F7 builds the one missing primitive: an `assertCan(key)` service helper on the same ALS resolver
`requirePermission` already uses (`currentActor()`/`holds()` — the "second half"
`middlewares/requirePermission.ts:16-20` promised and never built).

| # | key | where | the composed check |
|---|---|---|---|
| 18 | `member.edit_profile` | `UserService.updateProfile` (`PATCH /users/:id`) | `isSelf` stays free; the non-self branch: `isAdmin && holds("member.edit_profile")` |
| 19 | `task.delete_hard` | `TaskWriteService.del` (`DELETE /tasks/:id?hard=true`) | hard branch: `isAdmin && holds("task.delete_hard")` (ISS-024's special case #1 — the toggle stops being inert) |
| 20 | `comment.delete_any` | `CommentsService` delete (`DELETE /comments/:id`) | `isAuthor` stays free; else `isAdmin && holds("comment.delete_any")` (special case #2) |
| 21 | `attachment.delete_any` | `AttachmentsService.softDelete` (`DELETE /attachments/:id`) | `isUploader` stays free; else `isAdmin && holds("attachment.delete_any")` |
| 22 | `report.view` | `ReportsService.list` + direct read (`GET /reports`, `GET /reports/:id`) | head-scoping (current+snapshot head) stays untouched; the owner/admin branch: `isAdmin && holds("report.view")`. **Never a route middleware** — that would 403 department heads (legacy `member`s) and break dept-review |
| — | `space.head_assign` *(bonus)* | `SpacesService.update` (`PATCH /spaces/:id`) | route keeps `space.edit`; **when `head_user_id` is in the patch**: additionally `assertCan("space.head_assign")`. Closes the catalog-invariant violation (key enforced nowhere) |

## 3. Role → grant matrix: **no changes**

`SYSTEM_ROLE_GRANTS` (bootstrap) already encodes today's behaviour for all 56 keys and is pinned by
a snapshot test. The two rows that *looked* like divergences were verified and are not:

- **`attachment.upload`** — guests genuinely cannot upload today (legacy `Roles.GUEST` 403s), which
  matches guests not holding the key.
- **`report.view`** — "any member gets 200" on the list is an **empty head-scoped list**, not
  access; direct reads 403. The seeded admin-only grant matches the real read power, provided the
  gate is the §2.22 service compose, not a route gate.

So F7 Side 1 = **verify-only** (assert the seeded matrix against `role_permissions` in the live DB;
`database/upgrades/NNN_rbac_grants.sql` is NOT needed unless that assert fails on a drifted DB).

## 4. Deliberately left authenticate-only (recorded so nobody "finds" them later)

- **Reads riding task/space visibility** (repo-level `rbacContext` scoping): `GET /tasks/my-work`,
  `/tasks/:id`, `/tasks/:id/{subtasks,activity,comments,checklists,dependencies,attachments}`,
  `GET /sprints*` reads, `GET /custom-fields*` reads, `GET /templates*` reads, `GET /forms` +
  `/forms/:id` + `/lists/:listId/forms`, `GET /spaces*` reads, `GET /attachments/:id/download`.
- **Self-scoped surfaces** (no catalog key fits; invariant #1 forbids inventing one):
  `me.ts` (`GET /me/permissions`), `home.ts` (KPIs/agenda — the caller's own dashboard),
  `search.ts` (results are visibility-scoped in the repo), all 9 `notifications.ts` routes
  (own-inbox), `sse.ts`, watcher self-toggle (`POST/DELETE /tasks/:id/watchers/self`),
  `PATCH /comments/:id` (author-only-within-window service rule — an *edit* is not
  `comment.delete_any`'s business). This is the plan's "where does the gate live for the 3 odd
  routers" answer: **nowhere — by design.**
- **Review surfaces** already service-enforced per P5 (`review.*`, `report.generate`, `report.note`,
  `report.ack` route-gate exists): untouched. `review.perform`'s never-resolved P5 verdict is
  accepted as service-enforced (`ReviewsService` head/admin checks produce `review.forbidden`); F31
  re-probes it with real fixtures.
- **`GET /eng/home`** — aggregate read, any member.
- **Public by design:** `auth.ts` (5), `publicForms` surface, `health.ts`.

## 5. What F7 executes, in order

1. `assertCan(key)` helper in `rbac/` (ALS actor + `holds`; throws the same
   `routeForbidden`-shaped 403).
2. The 34 route-middleware additions of §1 (tasks 8 sites, checklists 8, attachments 3, comments 1,
   users 2, deps 2, custom-fields 2, sprints 2, eng 2, activity 2, templates 1, forms 1).
3. The 6 service composes of §2.
4. Grant-matrix assert (Side 1, verify-only per §3).
5. Re-run the P5 two-pass probe: expect **NOT ENFORCED → 0** for the 21; the 5 "other-mechanism"
   keys keep their existing verdicts.
6. The P39 day-in-the-life re-run (22/22) — the "nobody lost their job function" check.
7. Gate: `rbac`, `tasks`, `collab`, `attachments`, `taskdeps`, `workspaceActivity`, `eng`, `search`
   jest modules, serial.

**Blast-radius note for F7:** the public form submit creates tasks through `TaskWriteService`
*without* an HTTP actor — route gates on `POST /tasks` don't touch it, and `assertCan` must be
called only on the HTTP paths (the ALS actor is absent in job/public contexts; `requirePermission`'s
existing no-actor fallback already models this).
