import type OpenAI from "openai";
import type { Role } from "../constants";
import type { HomeService } from "../services/HomeService";
import type { SearchService } from "../services/SearchService";

/**
 * Read-only TOOLS the assistant can call to answer questions about the user's
 * OWN live data (see AI_ASSISTANT_PLAN.md, Phase 8 — data-aware / agentic).
 *
 * SECURITY: the model only supplies intent params (e.g. a search query); the
 * executor injects the caller's `userId` / `workspaceId` / `role` from the JWT,
 * so the model can NEVER reach another user's or workspace's data. All tools are
 * read-only — the assistant cannot mutate anything.
 */

export interface ToolContext {
    userId: string;
    workspaceId: string;
    role: Role;
}

export interface ToolServices {
    home: HomeService;
    search: SearchService;
}

export const ASSISTANT_TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] =
    [
        {
            type: "function",
            function: {
                name: "get_my_task_counts",
                description:
                    "Live task counts. Returns SIX separate numbers, each named for its scope: openTasksAssignedToMe, myTasksDueToday, myTasksOverdue, tasksAwaitingMyReview, openTasksAcrossTheWholeWorkspace, slaBreachesAcrossTheWholeWorkspace. Read the key that matches what was asked — a question about the team or the whole workspace is NOT the same as a question about the user's own tasks. Use whenever the user asks how many tasks there are.",
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
                    "Search the user's workspace for tasks, lists, and spaces matching a keyword. Use when the user asks to find or locate a specific item by name.",
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
    ];

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
        default:
            return { error: `Unknown tool: ${name}` };
    }
}
