# §24 — Search

> Source: [API_DESIGN.md §24](../API_DESIGN.md#24-search)

**1 endpoint.** Global typeahead across tasks, lists, spaces, users, and comments.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/search` | Multi-resource typeahead | 🔐 | L | ☐ |

## Dependencies

- §10 Tasks, §6 Lists, §5 Spaces, §4 Users, §14 Comments — sources to search.
- DB: simple `LIKE`/full-text against `tasks.name`, `tasks.custom_id`, `lists.name`, `spaces.name`, `users.email`, `comments.body`.

## Notes

- Query: `?q=…&types=task,list,space,user,comment&limit=20`.
- Default `limit=20`, max 50.
- Response shape: `{tasks: Task[], lists: List[], spaces: Space[], users: User[], comments: Comment[], total: number}`.
- Tasks also match on `custom_id` exactly (so a search for `ORD-1042` finds the task even if it's not in the name).
- All results scoped by workspace — no cross-tenant leak.
- For V1, plain `LIKE` is fine (test DB will have < 10k rows). V2 can add MySQL FULLTEXT with the ngram parser already configured in `_post.sql`.
