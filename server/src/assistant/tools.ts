import type OpenAI from "openai";
import type { Role } from "../constants";
import { AppError } from "../errors";
import { denyMessage, holds, permissionErrorCode } from "../rbac/can";
import { currentActor } from "../rbac/context";
import type { PermissionKey } from "../rbac/catalog";
import type { UsersRepo } from "../repositories/UsersRepo";
import type { MyTaskBucket } from "../repositories/HomeRepo";
import type { TasksRepo } from "../repositories/TasksRepo";
import type { SpacesRepo } from "../repositories/SpacesRepo";
import type { UserRolesRepo } from "../repositories/UserRolesRepo";
import type { DepartmentReportsRepo } from "../repositories/DepartmentReportsRepo";
import type { HomeService } from "../services/HomeService";
import type { SearchService } from "../services/SearchService";
import type { TaskWriteService } from "../services/TaskWriteService";
import type { AssignmentRequestsService } from "../services/AssignmentRequestsService";
import type { SlaService } from "../services/SlaService";

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
    /** Scoped task reads for `get_task_details` (deep-plan P3). */
    tasks: TasksRepo;
    /** People & teams (deep-plan P4) — scoped spaces + membership rows. */
    spaces: SpacesRepo;
    userRoles: UserRolesRepo;
    /** Approvals (deep-plan P5) — relationship-scoped in the service. */
    requests: AssignmentRequestsService;
    /** Weekly reports (deep-plan P6) — the tool gates, then reads the repo. */
    reports: DepartmentReportsRepo;
    /** SLA breaches (deep-plan P6) — the repo predicate is caller-scoped. */
    sla: SlaService;
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
                name: "get_my_tasks",
                description:
                    "The user's OWN tasks as a LIST of real rows (name, list, status, due date) — use this whenever they ask WHICH tasks, e.g. 'ami ki ki task e assign asi', 'amar overdue kaj kongula', 'ei shoptahe ki ki ache'. get_my_task_counts gives only NUMBERS; this gives the tasks themselves. Buckets: open (default, everything assigned to them that is not finished), overdue, due_soon (next 7 days), awaiting_review (completed work waiting for THEM to review, as a Head or named reviewer), done_recent. Capped — if the result says more:true, tell them there are others and point them at Home.",
                parameters: {
                    type: "object",
                    properties: {
                        bucket: {
                            type: "string",
                            enum: [
                                "open",
                                "overdue",
                                "due_soon",
                                "awaiting_review",
                                "done_recent",
                            ],
                            description: "Which view; omit for open",
                        },
                    },
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "get_task_details",
                description:
                    "Everything about ONE task the user can see — status, assignees, due date, priority, list/space, checklist progress, review verdict. Use for 'X task er ki obostha?', 'checklist koto% hoyeche?', 'kake deya ache?'. Accepts the task's name, its id, or its custom id. If it answers not_found, do NOT conclude the task exists somewhere hidden — say it was not found or is not visible to them.",
                parameters: {
                    type: "object",
                    properties: {
                        task: {
                            type: "string",
                            description:
                                "The task's name as the user said it, or its id / custom id",
                        },
                    },
                    required: ["task"],
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
                name: "get_people",
                description:
                    'People and teams. action="my_teams": the user\'s own teams with each head. action="team_roster": who is on a NAMED team (needs team_name). action="find_person": which team(s) a NAMED person is on (needs person_name; "@me" allowed). action="person_workload": how many open tasks a person has, counted only across what the ASKER can see (needs person_name). Use for "amar team e ke ke", "X kon team e", "Y er koyta kaj cholche", "amader head ke".',
                parameters: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: [
                                "my_teams",
                                "team_roster",
                                "find_person",
                                "person_workload",
                            ],
                        },
                        team_name: { type: "string" },
                        person_name: { type: "string" },
                    },
                    required: ["action"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "get_my_approvals",
                description:
                    'Cross-team assignment approval requests involving the user. box="received" (default): requests THEY must accept or decline. box="sent": requests they raised for someone else. box="team": requests targeting members of teams they HEAD. Use for "amar kache ki approval pending", "amar request er ki obostha". Deciding happens in the app — point them at Inbox → Requests.',
                parameters: {
                    type: "object",
                    properties: {
                        box: {
                            type: "string",
                            enum: ["received", "sent", "team"],
                        },
                    },
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "get_report_status",
                description:
                    "ALWAYS call this when asked whether a weekly department report is ready, when it covers, or who has seen it. Do NOT decide from the role rules in the knowledge base and do NOT refuse on your own: a team's HEAD may read their own team's reports without holding any admin permission, and only this tool can tell whether this caller qualifies. Optional team_name narrows to one team. It returns youCanReadReports plus the reports, or a permission error if they truly cannot — relay whichever comes back.",
                parameters: {
                    type: "object",
                    properties: { team_name: { type: "string" } },
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "get_sla_breaches",
                description:
                    "Bugs/complaints past their SLA deadline and not done, newest breach first — only ones the user can see. Use for 'kono task SLA miss korse?', 'deadline par hoye gese kongula?'.",
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
        case "get_my_tasks": {
            const bucket = MY_TASK_BUCKETS.includes(args.bucket as MyTaskBucket)
                ? (args.bucket as MyTaskBucket)
                : "open";
            // One over the cap, so "there are more" is a fact, not a guess.
            const rows = await services.home.myTasks({
                workspaceId: ctx.workspaceId,
                userId: ctx.userId,
                bucket,
                limit: MY_TASKS_CAP + 1,
            });
            const shown = rows.slice(0, MY_TASKS_CAP);
            return {
                bucket,
                count: shown.length,
                more: rows.length > MY_TASKS_CAP,
                tasks: shown.map((t) => ({
                    name: t.name,
                    url: `/t/${t.id}`,
                    list: t.listName,
                    team: t.spaceName,
                    status: t.statusName,
                    dueDate: dateOnly(t.dueDate),
                    priority: PRIORITY_WORD[t.priority] ?? "none",
                    checklist:
                        t.checklistTotal > 0
                            ? `${t.checklistDone}/${t.checklistTotal}`
                            : null,
                    review: t.reviewStatus,
                })),
            };
        }
        case "get_task_details":
            return taskDetailsTool(args, ctx, services);
        case "get_my_agenda": {
            const date = typeof args.date === "string" ? args.date : undefined;
            // A model-invented date ("kal", "next week") used to reach the SQL
            // and blow up, and the person got the service's last-resort
            // "tool_execution_failed" — a dead end they could do nothing with.
            if (date !== undefined && !isCalendarDay(date)) {
                return {
                    error: `"${date}" is not a date. Work the day out from today's date at the top of the prompt and pass it as YYYY-MM-DD, or omit it for today.`,
                };
            }
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
        case "get_people":
            return peopleTool(args, ctx, services);
        case "get_my_approvals": {
            const box =
                args.box === "sent" || args.box === "team"
                    ? args.box
                    : "received";
            const rows = await services.requests.listFor({
                workspaceId: ctx.workspaceId,
                actorId: ctx.userId,
                actorRole: ctx.role,
                box,
                onlyPending: true,
            });
            const shown = rows.slice(0, 10);
            return {
                box,
                count: shown.length,
                more: rows.length > 10,
                decideAt: "/inbox",
                requests: shown.map((r) => {
                    const who = (id: string | null): string => {
                        const u = id ? r.usersById.get(id) : undefined;
                        return u
                            ? `${u.firstName} ${u.lastName}`.trim()
                            : "unknown";
                    };
                    return {
                        task: r.task?.name ?? "(task no longer visible)",
                        url: r.task ? `/t/${r.task.id}` : null,
                        team: r.task?.spaceName ?? null,
                        list: r.task?.listName ?? null,
                        dueDate: dateOnly(r.task?.dueDate ?? null),
                        requestedBy: who(r.request.requestedBy),
                        target: who(r.request.targetUserId),
                        status: r.request.status,
                        expiresAt: r.request.expiresAt
                            ? String(r.request.expiresAt.toISOString()).slice(0, 10)
                            : null,
                    };
                }),
            };
        }
        case "get_report_status":
            return reportStatusTool(args, ctx, services);
        case "get_sla_breaches": {
            const rows = await services.sla.listBreached({
                workspaceId: ctx.workspaceId,
                filters: {},
            });
            const shown = rows.slice(0, 10);
            return {
                count: shown.length,
                more: rows.length > 10,
                queue: "/sla",
                breaches: shown.map((b) => ({
                    task: b.name,
                    url: `/t/${b.task_id}`,
                    hoursLate: Math.round(b.minutes_breached / 60),
                    assignees: b.assignees.map((a) =>
                        `${a.first_name} ${a.last_name}`.trim(),
                    ),
                })),
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

/** The "my work" views, and how many rows one answer may carry (D4). */
const MY_TASK_BUCKETS: readonly MyTaskBucket[] = [
    "open",
    "overdue",
    "due_soon",
    "awaiting_review",
    "done_recent",
];
const MY_TASKS_CAP = 20;

/** Priority is stored 0-4; the model must never invent its own scale. */
const PRIORITY_WORD: Record<number, string> = {
    0: "none",
    1: "urgent",
    2: "high",
    3: "normal",
    4: "low",
};

/**
 * Is `raw` a real calendar day in YYYY-MM-DD? The HTTP validators do this for
 * every normal request, but the tool path never passes through them, so the
 * tools own it. Rejects both shapes that reach us: a non-date string the model
 * invented ("kal", "next week") and a well-formed impossible date (2026-02-30).
 */
const isCalendarDay = (raw: string): boolean => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return (
        d.getUTCFullYear() === Number(m[1]) &&
        d.getUTCMonth() === Number(m[2]) - 1 &&
        d.getUTCDate() === Number(m[3])
    );
};

/** A DATE column, as the calendar day it is — never a timestamp. */
const dateOnly = (d: Date | string | null): string | null => {
    if (!d) return null;
    if (typeof d === "string") return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
};

/**
 * `get_task_details` — one task, as much as the caller is allowed to see.
 *
 * Resolution order: an id / custom id goes through the SCOPED repo read
 * (`listScopeFilter` + the own-escape), a name goes through the caller's own
 * search. Both refuse identically when the task is missing OR invisible: one
 * `not_found` shape with no name echoed back, because "it exists but you may
 * not see it" hands an outsider the very fact the permission protects.
 */
async function taskDetailsTool(
    args: Record<string, unknown>,
    ctx: ToolContext,
    services: ToolServices,
): Promise<unknown> {
    const wanted = typeof args.task === "string" ? args.task.trim() : "";
    if (!wanted) return { error: "Which task? Ask the user for its name." };

    const NOT_FOUND = {
        error: "not_found",
        code: "task.not_found",
        say: "Not found, or not visible to this user — do not claim it exists.",
    };

    // 1) Try it as an id / custom id (cheap, and exact).
    let row = await services.tasks.findDetailInWorkspace(
        wanted,
        ctx.workspaceId,
    );

    // 2) Otherwise resolve the NAME through the caller's own search.
    if (!row) {
        const byName = async (q: string) =>
            (
                await services.search.search({
                    workspaceId: ctx.workspaceId,
                    role: ctx.role,
                    q,
                    limit: 8,
                })
            ).tasks.map((t) => ({ id: t.id, name: t.name }));

        let hits = await byName(wanted);
        // The whole phrase found nothing. Search is a plain substring LIKE, so
        // ONE character the user typed differently (a hyphen where the real
        // name has an em dash) matches nothing at all. Retry with the words
        // BEFORE the first punctuation — that part is almost always a
        // contiguous substring of the real name. A person asking about their
        // own task must never be told it does not exist because of a dash.
        if (hits.length === 0) {
            const loose = looseQuery(wanted);
            if (loose) hits = await byName(loose);
        }
        const pick =
            exactMatch(hits, wanted) ?? (hits.length === 1 ? hits[0] : null);
        if (!pick) {
            return hits.length === 0
                ? NOT_FOUND
                : {
                      error: `More than one task matches "${wanted}". Ask the user which one they mean.`,
                      candidates: hits.slice(0, 5).map((h) => h.name),
                  };
        }
        row = await services.tasks.findDetailInWorkspace(
            pick.id,
            ctx.workspaceId,
        );
        if (!row) return NOT_FOUND;
    }

    const [assigneeIds, watcherIds] = await Promise.all([
        services.tasks.assigneesByTask([row.id]),
        services.tasks.watchersByTask([row.id]),
    ]);
    const ids = assigneeIds.get(row.id) ?? [];
    const people =
        ids.length > 0
            ? await services.users.findManyByIdsInWorkspace(
                  ids,
                  ctx.workspaceId,
              )
            : [];

    const total = row.checklistItemsTotal ?? 0;
    const done = row.checklistItemsDone ?? 0;
    return {
        name: row.name,
        url: `/t/${row.id}`,
        id: row.customId ?? row.id,
        status: row.statusName,
        list: row.listName,
        team: row.spaceName,
        dueDate: dateOnly(row.dueDate),
        startDate: dateOnly(row.startDate),
        priority: PRIORITY_WORD[row.priority] ?? "none",
        assignees: people.map((p) => `${p.firstName} ${p.lastName}`.trim()),
        unassigned: ids.length === 0,
        watchers: (watcherIds.get(row.id) ?? []).length,
        checklist:
            total > 0
                ? {
                      done,
                      total,
                      percent: Math.round((done / total) * 100),
                  }
                : null,
        review: row.reviewStatus,
        archived: !!row.archivedAt,
        completed: !!row.completedAt,
    };
}

/**
 * Compare names the way a person would, not the way a database does.
 *
 * Real task names in this workspace carry typographic dashes ("Repeated late
 * delivery — VIP customer") that nobody types; a live probe had a Customer
 * Service member asking about his OWN task with a plain hyphen and being told
 * "not found, or you do not have permission" — wrong, and alarming in exactly
 * the wrong direction. So dashes are unified, punctuation dropped and spaces
 * collapsed before matching.
 */
const normalizeName = (s: string): string =>
    s
        .toLowerCase()
        .replace(/[‐-―−]/g, "-") // – — ‑ − → -
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/g, " ");

/**
 * The honest-denial payload (deep-plan doctrine 4): the standard shape the
 * prompt knows how to render — permission named, action NOT performed. Used by
 * every tool whose surface the HTTP routes gate with `requirePermission`,
 * because the tool path never passes through those routes.
 */
const denied = (key: PermissionKey) => ({
    error: denyMessage(key, "no_grant"),
    code: permissionErrorCode(key),
    permission: key,
    reason: "no_grant",
});

/**
 * Resolve ONE person by name against the member directory — the logic
 * `create_task` grew (full string, then surname fallback, then exact match),
 * extracted so `get_people` answers with the same behaviour. "@me" resolves to
 * the caller (the model never knows their real name).
 *
 * Returns `{ person }` or `{ failure }` — the failure is a ready-made tool
 * result (missing → ask for the exact name; ambiguous → candidates).
 */
const resolvePerson = async (
    wanted: string,
    ctx: ToolContext,
    services: ToolServices,
): Promise<
    | { person: { id: string; name: string }; failure?: undefined }
    | { person?: undefined; failure: Record<string, unknown> }
> => {
    if (wanted.trim().toLowerCase() === "@me") {
        const me = await services.users.findByIdInWorkspace(
            ctx.userId,
            ctx.workspaceId,
        );
        return {
            person: {
                id: ctx.userId,
                name: me ? `${me.firstName} ${me.lastName}`.trim() : "you",
            },
        };
    }
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
        exactMatch(named, wanted) ?? (named.length === 1 ? named[0] : null);
    if (person) return { person };
    return {
        failure:
            named.length === 0
                ? {
                      error: `No active member matching "${wanted}" was found. Ask the user for the exact name.`,
                  }
                : {
                      error: `More than one person matches "${wanted}". Ask the user which one they mean.`,
                      candidates: named.map((p) => p.name),
                  },
    };
};

/**
 * `get_people` (deep-plan P4). EVERY mode requires `member.view` — the same
 * gate `GET /teams` carries — asserted HERE because the HTTP gate never runs
 * on the tool path. This is also the fix for finding G7: the directory used
 * to be reachable through `create_task` with only `assistant.use`.
 *
 * All space reads go through the SCOPED `SpacesRepo.listByWorkspace`, so a
 * team the caller cannot see stays invisible: its roster answers the same
 * ambiguous not-found as a team that does not exist.
 */
async function peopleTool(
    args: Record<string, unknown>,
    ctx: ToolContext,
    services: ToolServices,
): Promise<unknown> {
    if (!holds(await currentActor(), "member.view")) {
        return denied("member.view");
    }

    const action = String(args.action ?? "my_teams");
    const visible = await services.spaces.listByWorkspace(ctx.workspaceId, {
        includeArchived: false,
    });
    const visibleById = new Map(visible.map((s) => [s.id, s]));

    if (action === "my_teams") {
        const mine = new Set(
            await services.userRoles.spaceIdsForUser(
                ctx.userId,
                ctx.workspaceId,
            ),
        );
        const teams = visible.filter((s) => mine.has(s.id));
        const headIds = [
            ...new Set(
                teams
                    .map((t) => t.headUserId)
                    .filter((h): h is string => !!h),
            ),
        ];
        const heads =
            headIds.length > 0
                ? await services.users.findManyByIdsInWorkspace(
                      headIds,
                      ctx.workspaceId,
                  )
                : [];
        const headName = new Map(
            heads.map((h) => [h.id, `${h.firstName} ${h.lastName}`.trim()]),
        );
        return {
            count: teams.length,
            teams: teams.map((t) => ({
                team: t.name,
                head: t.headUserId
                    ? (headName.get(t.headUserId) ?? null)
                    : null,
                youAreHead: t.headUserId === ctx.userId,
            })),
            manageAt: "/settings/teams",
        };
    }

    if (action === "team_roster") {
        const teamName =
            typeof args.team_name === "string" ? args.team_name.trim() : "";
        if (!teamName)
            return { error: "Which team? Ask the user for the team's name." };
        const named = visible.map((s) => ({ id: s.id, name: s.name }));
        const team =
            exactMatch(named, teamName) ??
            (named.filter((s) =>
                normalizeName(s.name).includes(normalizeName(teamName)),
            ).length === 1
                ? named.find((s) =>
                      normalizeName(s.name).includes(normalizeName(teamName)),
                  )!
                : null);
        if (!team) {
            const close = named.filter((s) =>
                normalizeName(s.name).includes(normalizeName(teamName)),
            );
            return close.length > 1
                ? {
                      error: `More than one team matches "${teamName}". Ask the user which one they mean.`,
                      candidates: close.map((c) => c.name),
                  }
                : {
                      error: "not_found",
                      code: "space.not_found",
                      say: "No such team is visible to this user — do not claim it exists.",
                  };
        }
        const assignments = await services.userRoles.listBySpace(
            team.id,
            ctx.workspaceId,
        );
        const ids = [...new Set(assignments.map((a) => a.userId))];
        const people =
            ids.length > 0
                ? await services.users.findManyByIdsInWorkspace(
                      ids,
                      ctx.workspaceId,
                  )
                : [];
        const headId = visibleById.get(team.id)?.headUserId ?? null;
        const active = people.filter((p) => p.status !== "deactivated");
        const shown = active.slice(0, 10);
        return {
            team: team.name,
            count: active.length,
            more: active.length > shown.length,
            head: headId
                ? (() => {
                      const h = people.find((p) => p.id === headId);
                      return h
                          ? `${h.firstName} ${h.lastName}`.trim()
                          : null;
                  })()
                : null,
            members: shown.map((p) => ({
                name: `${p.firstName} ${p.lastName}`.trim(),
                isHead: p.id === headId,
            })),
        };
    }

    const personName =
        typeof args.person_name === "string" ? args.person_name.trim() : "";
    if (!personName)
        return { error: "Which person? Ask the user for their name." };
    const resolved = await resolvePerson(personName, ctx, services);
    if (resolved.failure) return resolved.failure;
    const person = resolved.person;

    if (action === "person_workload") {
        const open = await services.tasks.countOpenAssignedVisible(
            person.id,
            ctx.workspaceId,
        );
        return {
            person: person.name,
            openTasksYouCanSee: open,
            note: "counted only across tasks the asker can see",
        };
    }

    // find_person — team names go through the CALLER's visible set only; a
    // hidden team becomes a count, never a name (anti-enumeration).
    const theirSpaceIds = await services.userRoles.spaceIdsForUser(
        person.id,
        ctx.workspaceId,
    );
    const primaryId = await services.users.primarySpaceIdOf(
        person.id,
        ctx.workspaceId,
    );
    const visibleTeams = theirSpaceIds
        .filter((id) => visibleById.has(id))
        .map((id) => {
            const s = visibleById.get(id)!;
            return {
                team: s.name,
                head: s.headUserId === person.id,
                home: id === primaryId,
            };
        });
    return {
        person: person.name,
        teams: visibleTeams,
        hiddenTeams: theirSpaceIds.length - visibleTeams.length,
    };
}

/**
 * `get_report_status` (deep-plan P6). Mirrors `ReportsService.list`'s
 * visibility EXACTLY: an Owner/Admin whose role holds `report.view` sees every
 * department; everyone else sees the departments they currently HEAD. A caller
 * with neither gets the honest denial, and never learns whether reports exist.
 */
async function reportStatusTool(
    args: Record<string, unknown>,
    ctx: ToolContext,
    services: ToolServices,
): Promise<unknown> {
    const actor = await currentActor();
    const visible = await services.spaces.listByWorkspace(ctx.workspaceId, {
        includeArchived: false,
    });
    const headedIds = visible
        .filter((s) => s.headUserId === ctx.userId)
        .map((s) => s.id);
    const isAdminish = ctx.role === "owner" || ctx.role === "admin";
    const seesAll = isAdminish && holds(actor, "report.view");
    if (!seesAll && headedIds.length === 0) {
        return denied("report.view");
    }

    let spaceId: string | undefined;
    const teamName =
        typeof args.team_name === "string" ? args.team_name.trim() : "";
    if (teamName) {
        const named = visible.map((s) => ({ id: s.id, name: s.name }));
        const team = exactMatch(named, teamName);
        if (!team) {
            return {
                error: "not_found",
                code: "space.not_found",
                say: "No such team is visible to this user — do not claim it exists.",
            };
        }
        spaceId = team.id;
    }

    const rows = await services.reports.list({
        workspaceId: ctx.workspaceId,
        spaceId,
        headVisibility: seesAll
            ? undefined
            : { userId: ctx.userId, headedSpaceIds: headedIds },
        limit: 6,
    });
    const nameOf = new Map(visible.map((s) => [s.id, s.name]));
    return {
        // A live probe had the model turn an EMPTY list into "you do not have
        // permission" — told a department Head she could not read her own
        // team's reports, when the truth was that none had been generated yet.
        // Passing the permission verdict explicitly leaves nothing to guess.
        youCanReadReports: true,
        ...(rows.length === 0
            ? {
                  note: "This user CAN read reports; none have been generated yet. Reports are created automatically every Monday.",
              }
            : {}),
        count: Math.min(rows.length, 5),
        reports: rows.slice(0, 5).map((r) => ({
            team: nameOf.get(r.spaceId) ?? "(team)",
            week: `${r.weekStart} – ${r.weekEnd}`,
            generatedAt: String(r.generatedAt.toISOString()).slice(0, 10),
            seen: !!r.acknowledgedBy,
            hasHeadNote: !!r.headNote,
        })),
        readAt: "/reports",
    };
}

/**
 * A shorter query that is still a CONTIGUOUS substring of the intended name —
 * the words before the first punctuation mark, capped at four. Used only after
 * the full phrase found nothing, because search is a plain `LIKE %q%` and one
 * mistyped dash therefore matches zero rows.
 */
const looseQuery = (s: string): string | null => {
    const head = (s.split(/[^\p{L}\p{N}\s]/u)[0] ?? "").trim();
    const words = head.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return words.slice(0, 4).join(" ");
    const all = s.trim().split(/\s+/).filter(Boolean);
    return all.length > 1 ? all.slice(0, 3).join(" ") : null;
};

/** Case-insensitive, punctuation-tolerant exact-name pick, else null. */
const exactMatch = <T extends { name: string }>(
    candidates: T[],
    wanted: string,
): T | null => {
    const want = normalizeName(wanted);
    const hits = candidates.filter((c) => normalizeName(c.name) === want);
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
    //
    // G7 fix (deep-plan P4): naming an assignee READS the member directory, so
    // it now requires `member.view` — the same gate the Members page and the
    // people tool carry. Without it, `assistant.use` alone was a name-existence
    // oracle. "@me" stays allowed: it reads nothing but the caller's own row.
    const assigneeIds: string[] = [];
    const pendingNames: string[] = [];
    const rawNames = Array.isArray(args.assignee_names)
        ? args.assignee_names.filter((n): n is string => typeof n === "string")
        : [];
    const onlySelf = rawNames.every(
        (n) => n.trim().toLowerCase() === "@me",
    );
    if (rawNames.length > 0 && !onlySelf) {
        if (!holds(await currentActor(), "member.view")) {
            return denied("member.view");
        }
    }
    for (const wanted of rawNames.slice(0, 10)) {
        const resolved = await resolvePerson(wanted, ctx, services);
        if (resolved.failure) return resolved.failure;
        const person = resolved.person;
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
        if (!isCalendarDay(raw)) {
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
