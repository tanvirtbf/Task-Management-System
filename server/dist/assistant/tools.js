"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSISTANT_TOOL_DEFS = void 0;
exports.executeAssistantTool = executeAssistantTool;
const errors_1 = require("../errors");
exports.ASSISTANT_TOOL_DEFS = [
    {
        type: "function",
        function: {
            name: "get_my_task_counts",
            description: "Live task counts. Returns SIX separate numbers, each named for its scope: openTasksAssignedToMe, myTasksDueToday, myTasksOverdue, tasksAwaitingMyReview, openTasksAcrossTheWholeWorkspace, slaBreachesAcrossTheWholeWorkspace. Read the key that matches what was asked — a question about the team or the workspace is NOT the same as a question about the user's own tasks. IMPORTANT: the two AcrossTheWholeWorkspace numbers cover everything THIS USER is allowed to see — for a team-scoped member that is their team(s), not the whole company; say 'across everything you can see' rather than claiming the whole company. Use whenever the user asks how many tasks there are.",
            parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_my_agenda",
            description: "List the current user's tasks due on a date (defaults to today). Use for 'what's on my plate today', 'my tasks for today/this date', etc.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "YYYY-MM-DD; omit for today",
                    },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "search",
            description: "Search the tasks, lists, and spaces THIS USER can see for a keyword (team-scoped members search their own teams' work, not the whole company). Use when the user asks to find or locate a specific item by name.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Keywords to search for",
                    },
                },
                required: ["query"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_task",
            description: "Create a REAL task in this workspace, as the current user, with all their normal permissions. Call it ONLY when the user explicitly asks to create/add a task AND has told you which list it belongs in — if no list was named, ask them first (the `search` tool can show matching list names). Assigning someone from another team does not assign them instantly: it opens an approval request they must accept (report that from the result's pendingApproval). If the result contains `error`, the task was NOT created — explain the error simply and never claim success.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "The task title, exactly as the user wants it (max 500 chars)",
                    },
                    list_name: {
                        type: "string",
                        description: "The name of the list the task goes in, as the user said it",
                    },
                    description: {
                        type: "string",
                        description: "Optional longer details",
                    },
                    due_date: {
                        type: "string",
                        description: "Optional due date, YYYY-MM-DD (resolve words like 'tomorrow' using today's date from the system prompt)",
                    },
                    priority: {
                        type: "integer",
                        description: "Optional 0-4 (0 none, 1 urgent, 2 high, 3 normal, 4 low)",
                    },
                    assignee_names: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional people to assign, by name as the user said them",
                    },
                },
                required: ["name", "list_name"],
                additionalProperties: false,
            },
        },
    },
];
/**
 * Execute a tool by name. `ctx` is the authenticated caller (never client
 * input); `args` are the model-supplied parameters. Returns a JSON-serialisable
 * result that is fed back to the model.
 */
async function executeAssistantTool(name, args, ctx, services) {
    switch (name) {
        case "get_my_task_counts": {
            const k = await services.home.kpis(ctx.workspaceId, ctx.userId);
            // The keys are deliberately long and self-describing. With terse
            // ones (`myOpenTasks` / `openTeamTasks`) the model read the wrong
            // field: asked "how many open tasks in the whole workspace?" it
            // answered with the user's own count — right data, wrong number,
            // and no way for the reader to tell. Naming the scope inside the
            // key costs a few tokens and removes the ambiguity entirely.
            return {
                openTasksAssignedToMe: k.myTasks.value,
                myTasksDueToday: k.dueToday.value,
                myTasksOverdue: k.overdue.value,
                tasksAwaitingMyReview: k.awaitingReview.value,
                openTasksAcrossTheWholeWorkspace: k.openTeamTasks.value,
                slaBreachesAcrossTheWholeWorkspace: k.slaBreaches.value,
            };
        }
        case "get_my_agenda": {
            const date = typeof args.date === "string" ? args.date : undefined;
            const tasks = await services.home.agenda(ctx.workspaceId, ctx.userId, ctx.role, date);
            return {
                count: tasks.length,
                tasks: tasks.slice(0, 15).map((t) => ({
                    id: t.custom_id ?? t.id,
                    name: t.name,
                    priority: t.priority,
                    dueDate: t.due_date,
                })),
            };
        }
        case "search": {
            const q = typeof args.query === "string" ? args.query : "";
            const r = await services.search.search({
                workspaceId: ctx.workspaceId,
                role: ctx.role,
                q,
                limit: 8,
            });
            return {
                total: r.total,
                tasks: r.tasks
                    .slice(0, 8)
                    .map((t) => ({ id: t.custom_id ?? t.id, name: t.name })),
                lists: r.lists
                    .slice(0, 5)
                    .map((l) => ({ id: l.id, name: l.name })),
                spaces: r.spaces.slice(0, 5).map((s) => ({ name: s.name })),
            };
        }
        case "create_task": {
            try {
                return await createTaskTool(args, ctx, services);
            }
            catch (err) {
                // The model must RELAY a refusal, never crash the chat or act
                // around it. AppError messages are already human-readable
                // (validation, permissions, the team-access rules).
                if (err instanceof errors_1.AppError) {
                    return { error: err.message, code: err.code };
                }
                throw err;
            }
        }
        default:
            return { error: `Unknown tool: ${name}` };
    }
}
/** Case-insensitive exact-name pick from `candidates`, else null. */
const exactMatch = (candidates, wanted) => {
    const lc = wanted.trim().toLowerCase();
    const hits = candidates.filter((c) => c.name.trim().toLowerCase() === lc);
    return hits.length === 1 ? hits[0] : null;
};
/**
 * `create_task` — the assistant's ONE write. Everything the model supplies is
 * intent; identity comes from the JWT context, and the create itself is the
 * REAL `TaskWriteService.create` running inside this authenticated request —
 * so the caller's `task.create` reach is asserted, a cross-team assignee
 * becomes a pending approval request (team-access P8), the audit row is
 * written, and the assignment notifications/emails fire exactly as if they
 * had used the New-task button.
 */
async function createTaskTool(args, ctx, services) {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    const listName = typeof args.list_name === "string" ? args.list_name.trim() : "";
    if (!name)
        return { error: "The task needs a name." };
    if (name.length > 500)
        return { error: "The task name is too long (max 500 characters)." };
    if (!listName)
        return {
            error: "No list was named. Ask the user which list the task belongs in.",
        };
    // Resolve the LIST by name through the user's OWN search (scope-filtered:
    // a team-scoped member can only ever land a task in a list they can see).
    const found = await services.search.search({
        workspaceId: ctx.workspaceId,
        role: ctx.role,
        q: listName,
        limit: 8,
    });
    const lists = found.lists.map((l) => ({ id: l.id, name: l.name }));
    const list = exactMatch(lists, listName) ?? (lists.length === 1 ? lists[0] : null);
    if (!list) {
        return lists.length === 0
            ? {
                error: `No list matching "${listName}" is visible to this user. Ask them for the exact list name.`,
            }
            : {
                error: `More than one list matches "${listName}". Ask the user which one they mean.`,
                candidates: lists.map((l) => l.name),
            };
    }
    // Resolve ASSIGNEES by name against the member directory. Any ambiguity
    // or miss aborts the create — a task quietly assigned to the wrong Rahim
    // is worse than a follow-up question.
    const assigneeIds = [];
    const pendingNames = [];
    const rawNames = Array.isArray(args.assignee_names)
        ? args.assignee_names.filter((n) => typeof n === "string")
        : [];
    for (const wanted of rawNames.slice(0, 10)) {
        // The directory's q filter matches per COLUMN (first name, last name,
        // email) — a full "Rahim Uddin" matches neither column alone. Try the
        // full string first, then fall back to the last word (the surname)
        // and let the exact full-name match below disambiguate.
        let rows = await services.users.listByWorkspace({
            workspaceId: ctx.workspaceId,
            q: wanted.trim(),
            status: "active",
            limit: 6,
        });
        const words = wanted.trim().split(/\s+/);
        if (rows.length === 0 && words.length > 1) {
            rows = await services.users.listByWorkspace({
                workspaceId: ctx.workspaceId,
                q: words[words.length - 1],
                status: "active",
                limit: 6,
            });
        }
        const named = rows.map((u) => ({
            id: u.id,
            name: `${u.firstName} ${u.lastName}`.trim(),
        }));
        const person = exactMatch(named, wanted) ??
            (named.length === 1 ? named[0] : null);
        if (!person) {
            return named.length === 0
                ? {
                    error: `No active member matching "${wanted}" was found. Ask the user for the exact name.`,
                }
                : {
                    error: `More than one person matches "${wanted}". Ask the user which one they mean.`,
                    candidates: named.map((p) => p.name),
                };
        }
        assigneeIds.push(person.id);
        pendingNames.push(person.name);
    }
    // Date FORMAT is normally the HTTP validator's job — this path skips the
    // route validator, so the tool guards it itself (a real calendar day,
    // YYYY-MM-DD), or garbage like "kal" would reach the DATE column.
    let dueDate = null;
    if (typeof args.due_date === "string" && args.due_date.trim() !== "") {
        const raw = args.due_date.trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        const asDate = m
            ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
            : null;
        const valid = !!m &&
            !!asDate &&
            asDate.getUTCFullYear() === Number(m[1]) &&
            asDate.getUTCMonth() === Number(m[2]) - 1 &&
            asDate.getUTCDate() === Number(m[3]);
        if (!valid) {
            return {
                error: `The due date must be a real calendar day in YYYY-MM-DD form (got "${raw}"). Work it out from today's date and try again, or ask the user.`,
            };
        }
        dueDate = raw;
    }
    const created = await services.taskWrite.create({
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        role: ctx.role,
        primaryListId: list.id,
        name,
        description: typeof args.description === "string"
            ? args.description.slice(0, 10_000)
            : null,
        dueDate,
        priority: typeof args.priority === "number" &&
            Number.isInteger(args.priority) &&
            args.priority >= 0 &&
            args.priority <= 4
            ? args.priority
            : undefined,
        assignees: assigneeIds,
    });
    // Team-access P8: a cross-team pick is NOT on the task — it became a
    // pending approval request. Tell the model who is actually on vs waiting.
    const onTask = new Set(created.assignees);
    const assigned = [];
    const pendingApproval = [];
    assigneeIds.forEach((id, i) => {
        (onTask.has(id) ? assigned : pendingApproval).push(pendingNames[i]);
    });
    return {
        created: true,
        id: created.id,
        name: created.name,
        url: `/t/${created.id}`,
        list: list.name,
        dueDate: created.due_date,
        priority: created.priority,
        assigned,
        pendingApproval,
    };
}
