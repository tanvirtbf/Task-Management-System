import type OpenAI from "openai";
import type { Role } from "../constants";
import { AppError } from "../errors";
import type { UsersRepo } from "../repositories/UsersRepo";
import type { HomeService } from "../services/HomeService";
import type { SearchService } from "../services/SearchService";
import type { TaskWriteService } from "../services/TaskWriteService";

/**
 * TOOLS the assistant can call (see AI_ASSISTANT_PLAN.md, Phase 8 —
 * data-aware / agentic; `create_task` added 2026-08-12).
 *
 * SECURITY: the model only supplies intent params (e.g. a search query, a task
 * name); the executor injects the caller's `userId` / `workspaceId` / `role`
 * from the JWT, so the model can NEVER reach another user's or workspace's
 * data. The read tools stay read-only. The ONE write tool, `create_task`,
 * goes through the REAL `TaskWriteService.create` under the caller's own
 * request context — so it can do exactly what that person could do with the
 * New-task button, nothing more: their `task.create` reach is asserted, a
 * cross-team assignee still becomes an approval request (team-access P8), the
 * audit row and notifications fire, and every validation (dates, list, names)
 * answers as a readable error the model must relay, never act around.
 *
 * REACH (team-access P5): every query behind these tools runs under the
 * caller's own RBAC visibility (the repos apply `listScopeFilter` /
 * `spaceScopeFilter`), so a team-scoped member's numbers and search results
 * cover exactly what THEY can see. The tool descriptions say so explicitly —
 * the `AcrossTheWholeWorkspace` KEY NAMES are kept for wire stability, but
 * the model is told not to present them as the whole company.
 */

export interface ToolContext {
    userId: string;
    workspaceId: string;
    role: Role;
}

export interface ToolServices {
    home: HomeService;
    search: SearchService;
    /** The write path — the same service the New-task button uses. */
    taskWrite: TaskWriteService;
    users: UsersRepo;
}

export const ASSISTANT_TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] =
    [
        {
            type: "function",
            function: {
                name: "get_my_task_counts",
                description:
                    "Live task counts. Returns SIX separate numbers, each named for its scope: openTasksAssignedToMe, myTasksDueToday, myTasksOverdue, tasksAwaitingMyReview, openTasksAcrossTheWholeWorkspace, slaBreachesAcrossTheWholeWorkspace. Read the key that matches what was asked — a question about the team or the workspace is NOT the same as a question about the user's own tasks. IMPORTANT: the two AcrossTheWholeWorkspace numbers cover everything THIS USER is allowed to see — for a team-scoped member that is their team(s), not the whole company; say 'across everything you can see' rather than claiming the whole company. Use whenever the user asks how many tasks there are.",
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
                description:
                    "List the current user's tasks due on a date (defaults to today). Use for 'what's on my plate today', 'my tasks for today/this date', etc.",
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
                description:
                    "Search the tasks, lists, and spaces THIS USER can see for a keyword (team-scoped members search their own teams' work, not the whole company). Use when the user asks to find or locate a specific item by name.",
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
                description:
                    "Create a REAL task in this workspace, as the current user, with all their normal permissions. Call it ONLY when the user explicitly asks to create/add a task AND has told you which list it belongs in — if no list was named, ask them first (the `search` tool can show matching list names). Assigning someone from another team does not assign them instantly: it opens an approval request they must accept (report that from the result's pendingApproval). If the result contains `error`, the task was NOT created — explain the error simply and never claim success.",
                parameters: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description:
                                "The task title, exactly as the user wants it (max 500 chars)",
                        },
                        list_name: {
                            type: "string",
                            description:
                                "The name of the list the task goes in, as the user said it",
                        },
                        description: {
                            type: "string",
                            description: "Optional longer details",
                        },
                        due_date: {
                            type: "string",
                            description:
                                "Optional due date, YYYY-MM-DD (resolve words like 'tomorrow' using today's date from the system prompt)",
                        },
                        priority: {
                            type: "integer",
                            description:
                                "Optional 0-4 (0 none, 1 urgent, 2 high, 3 normal, 4 low)",
                        },
                        assignee_names: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                'Optional people to assign, by name as the user said them. When the user wants the task assigned to THEMSELVES ("assign it to me"), pass the literal string "@me" — never guess their name.',
                        },
                    },
                    required: ["name", "list_name"],
                    additionalProperties: false,
                },
            },
        },
    ];

/**
 * Per-REQUEST tool executor. Same contract as `executeAssistantTool`, plus one
 * guard that needs request-lifetime state: if the model asks to create the
 * SAME task twice in one message (gpt-4o-mini sometimes emits duplicate
 * parallel tool calls, or re-calls after already succeeding), the second call
 * returns the FIRST call's result instead of writing a second row. Distinct
 * name/list pairs still create separately — "make two tasks: A and B" works.
 * Only successes are memoised, so a failed attempt may be retried with
 * corrected arguments.
 */
export function makeAssistantToolExecutor(
    ctx: ToolContext,
    services: ToolServices,
): (name: string, args: Record<string, unknown>) => Promise<unknown> {
    const createdThisRequest = new Map<string, unknown>();
    return async (name, args) => {
        if (name !== "create_task") {
            return executeAssistantTool(name, args, ctx, services);
        }
        const key = [
            typeof args.name === "string" ? args.name.trim().toLowerCase() : "",
            typeof args.list_name === "string"
                ? args.list_name.trim().toLowerCase()
                : "",
        ].join(" ");
        const prior = createdThisRequest.get(key);
        if (prior !== undefined) return prior;
        const result = await executeAssistantTool(name, args, ctx, services);
        if ((result as { created?: boolean } | null)?.created === true) {
            createdThisRequest.set(key, result);
        }
        return result;
    };
}

/**
 * Execute a tool by name. `ctx` is the authenticated caller (never client
 * input); `args` are the model-supplied parameters. Returns a JSON-serialisable
 * result that is fed back to the model.
 */
export async function executeAssistantTool(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    services: ToolServices,
): Promise<unknown> {
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
            const tasks = await services.home.agenda(
                ctx.workspaceId,
                ctx.userId,
                ctx.role,
                date,
            );
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
            } catch (err) {
                // The model must RELAY a refusal, never crash the chat or act
                // around it. AppError messages are already human-readable
                // (validation, permissions, the team-access rules).
                if (err instanceof AppError) {
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
const exactMatch = <T extends { name: string }>(
    candidates: T[],
    wanted: string,
): T | null => {
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
async function createTaskTool(
    args: Record<string, unknown>,
    ctx: ToolContext,
    services: ToolServices,
): Promise<unknown> {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    const listName =
        typeof args.list_name === "string" ? args.list_name.trim() : "";
    if (!name) return { error: "The task needs a name." };
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
    const list =
        exactMatch(lists, listName) ?? (lists.length === 1 ? lists[0] : null);
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
    const assigneeIds: string[] = [];
    const pendingNames: string[] = [];
    const rawNames = Array.isArray(args.assignee_names)
        ? args.assignee_names.filter((n): n is string => typeof n === "string")
        : [];
    for (const wanted of rawNames.slice(0, 10)) {
        // "@me" = the chatting user themselves. The model does not know their
        // real name (identity lives in the JWT, not the prompt), so "assign it
        // to me" resolves here instead of failing a directory lookup.
        if (wanted.trim().toLowerCase() === "@me") {
            if (!assigneeIds.includes(ctx.userId)) {
                const me = await services.users.findByIdInWorkspace(
                    ctx.userId,
                    ctx.workspaceId,
                );
                assigneeIds.push(ctx.userId);
                pendingNames.push(
                    me ? `${me.firstName} ${me.lastName}`.trim() : "you",
                );
            }
            continue;
        }
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
        const person =
            exactMatch(named, wanted) ??
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
        // Two spellings of the same person ("Sadia", "Sadia Islam") resolve to
        // one id — the service dedupes ids anyway, but the NAME list must not
        // report the same person twice.
        if (!assigneeIds.includes(person.id)) {
            assigneeIds.push(person.id);
            pendingNames.push(person.name);
        }
    }

    // Date FORMAT is normally the HTTP validator's job — this path skips the
    // route validator, so the tool guards it itself (a real calendar day,
    // YYYY-MM-DD), or garbage like "kal" would reach the DATE column.
    let dueDate: string | null = null;
    if (typeof args.due_date === "string" && args.due_date.trim() !== "") {
        const raw = args.due_date.trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        const asDate = m
            ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
            : null;
        const valid =
            !!m &&
            !!asDate &&
            asDate.getUTCFullYear() === Number(m![1]) &&
            asDate.getUTCMonth() === Number(m![2]) - 1 &&
            asDate.getUTCDate() === Number(m![3]);
        if (!valid) {
            return {
                error: `The due date must be a real calendar day in YYYY-MM-DD form (got "${raw}"). Work it out from today's date and try again, or ask the user.`,
            };
        }
        dueDate = raw;
    }

    // A provided-but-invalid priority must REFUSE, not silently fall back to
    // the default — the model would otherwise confirm "high" while the task
    // ended up priority-none.
    let priority: number | undefined;
    if (args.priority !== undefined && args.priority !== null) {
        const p = args.priority;
        if (
            typeof p !== "number" ||
            !Number.isInteger(p) ||
            p < 0 ||
            p > 4
        ) {
            return {
                error: `priority must be a whole number 0-4 (0 none, 1 urgent, 2 high, 3 normal, 4 low) — got ${JSON.stringify(p)}.`,
            };
        }
        priority = p;
    }

    const created = await services.taskWrite.create({
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        role: ctx.role,
        primaryListId: list.id,
        name,
        description:
            typeof args.description === "string"
                ? args.description.slice(0, 10_000)
                : null,
        dueDate,
        priority,
        assignees: assigneeIds,
    });

    // Team-access P8: a cross-team pick is NOT on the task — it became a
    // pending approval request. Tell the model who is actually on vs waiting.
    const onTask = new Set(created.assignees);
    const assigned: string[] = [];
    const pendingApproval: string[] = [];
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
