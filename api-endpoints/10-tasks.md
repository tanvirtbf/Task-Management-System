# §10 — Tasks

> Source: [API_DESIGN.md §10](../API_DESIGN.md#10-tasks)

**11 endpoints.** The central resource — every other feature feeds into or off of these. Includes bulk operations and a personalised "my work" rollup.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/lists/:listId/tasks` | List tasks in a list, with filters | 🔐 | M | ☐ |
| 2 | GET | `/api/v1/tasks/:id` | Read a single task (includes counters, eng fields) | 🔐 | S | ☐ |
| 3 | GET | `/api/v1/tasks/:id/subtasks` | Children of a parent task | 🔐 | S | ☐ |
| 4 | POST | `/api/v1/tasks` | Create a task | 🔐 | L | ☐ |
| 5 | PATCH | `/api/v1/tasks/:id` | Update any task field (partial body) | 🔐 | L | ☐ |
| 6 | POST | `/api/v1/tasks/:id/archive` | Soft-delete | 🔐 | S | ☐ |
| 7 | POST | `/api/v1/tasks/:id/unarchive` | Reverse #6 | 🔐 | S | ☐ |
| 8 | DELETE | `/api/v1/tasks/:id` | Soft-delete (alias of archive) | 🔐 | S | ☐ |
| 9 | DELETE | `/api/v1/tasks/:id?hard=true` | Hard-delete (admin only, audit-logged) | 👑 | M | ☐ |
| 10 | POST | `/api/v1/tasks/bulk` | Bulk-edit (assignee, status, tags, archive) | 🔐 | XL | ☐ |
| 11 | GET | `/api/v1/tasks/my-work` | Today / Overdue / Next 7 / Unscheduled / Done buckets | 🔐 | M | ☐ |

## Dependencies

- §5, §6, §7, §8, §9 (spaces, lists, statuses, task types, tags).
- DB tables: `tasks`, `task_assignees`, `task_watchers`, `task_tags`, `task_dependencies`, `task_activity`, `statuses`, `lists`.
- Triggers: subtask counters + dependency self-loop guard are already wired in `_post.sql`.

## Notes

- **#4 create**: must wrap in a transaction (task + first activity row + initial assignees). Auto-set `sla_due_at` per type/severity policy (see §29).
- **#5 update**: respect `If-Match` ETag — return `409 task.version_conflict` on stale write.
- **#10 bulk**: target ≤ 200 task IDs per call, single transaction, fail-atomic.
- **#11 my-work**: response shape is `{today: Task[], overdue: Task[], next: Task[], unscheduled: Task[], done: Task[]}` — return tasks for `req.auth.sub`.
- Status transitions trigger `task_activity` entries + may fan-out notifications (assignees, watchers).
