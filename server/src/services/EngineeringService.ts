import type { Logger } from "winston";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type * as schema from "../db/schema";
import { AppError } from "../errors";
import { Roles, type Role } from "../constants";
import {
    bugSeverities,
    reporterTeams,
    type Sprint,
    type TaskPostmortem,
} from "../db/schema";
import { runWithPrincipal } from "../rbac/context";
import { bugIntakePrincipal } from "../rbac/principals";
import type { EngineeringRepo } from "../repositories/EngineeringRepo";
import type { TasksRepo } from "../repositories/TasksRepo";
import type { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import type { UsersRepo } from "../repositories/UsersRepo";
import type { TaskWriteService } from "./TaskWriteService";
import { toWireTask, type WireTask } from "../serializers/taskSerializer";
import { toWireUser, type WireUser } from "../serializers/userSerializer";

type BugSeverity = (typeof bugSeverities)[number];
type ReporterTeam = (typeof reporterTeams)[number];

export interface ReportBugInput {
    workspaceId: string;
    actorId: string;
    role: Role;
    steps: string;
    happened: string;
    expected?: string;
    severity?: BugSeverity;
    reporterTeam: ReporterTeam;
    url?: string;
    screenshots?: string[];
}

export interface EngHomeInput {
    workspaceId: string;
    userId: string;
    role: Role;
}

/** Wire `Sprint` per API_DESIGN.md Appendix A (snake_case; no `workspace_id`). */
export interface WireSprint {
    id: string;
    name: string;
    goal: string | null;
    start_date: string;
    end_date: string;
    status: string;
    committed_points: number;
    created_at: string;
    updated_at: string;
}

/** The `GET /api/v1/eng/home` response (API_DESIGN.md §22). */
export interface EngHome {
    open_bugs: { count: number; top: WireTask[] };
    my_sprint_tasks: WireTask[];
    prs_awaiting_me: WireTask[];
    open_incidents: { count: number; top: WireTask[] };
    stale_tickets: WireTask[];
    current_on_call: WireUser | null;
    active_sprint: WireSprint | null;
}

export interface SubmitPostmortemInput {
    workspaceId: string;
    incidentId: string;
    items: Record<string, boolean>;
    actorId: string;
}

/** Wire `Postmortem` returned by GET/POST `/eng/incidents/:id/postmortem`.
 *  Timestamps are null ONLY on the GET's "nothing saved yet" empty shape. */
export interface WirePostmortem {
    task_id: string;
    items: Record<string, boolean>;
    updated_by: string | null;
    created_at: string | null;
    updated_at: string | null;
}

const TITLE_MAX = 120;
/** Newest items shown in the open-bugs / open-incidents tiles (count is full). */
const TOP_LIMIT = 5;
/** Cap for the my-sprint / prs-awaiting / stale-tickets lists. */
const BUCKET_LIMIT = 25;
/** A postmortem may only be submitted once an Incident is in one of these. */
const POSTMORTEM_STATUS_GROUPS = new Set(["done", "closed"]);

/** First non-empty line of `primary`, then `secondary`; capped; safe fallback. */
const deriveTitle = (primary: string, secondary: string): string => {
    const firstLine = (s: string): string => {
        for (const line of s.split("\n")) {
            const t = line.trim();
            if (t.length > 0) return t;
        }
        return "";
    };
    const title = firstLine(primary) || firstLine(secondary) || "Bug report";
    return title.length > TITLE_MAX
        ? `${title.slice(0, TITLE_MAX - 1)}…`
        : title;
};

/** Compose a readable markdown bug description from the intake fields. */
const composeDescription = (input: ReportBugInput): string => {
    const parts: string[] = [
        `**Steps to reproduce**\n${input.steps}`,
        `**What happened**\n${input.happened}`,
    ];
    if (input.expected && input.expected.length > 0) {
        parts.push(`**Expected**\n${input.expected}`);
    }
    if (input.url && input.url.length > 0) {
        parts.push(`**URL:** ${input.url}`);
    }
    if (input.screenshots && input.screenshots.length > 0) {
        parts.push(`**Screenshots:** ${input.screenshots.join(", ")}`);
    }
    parts.push(`_Reported via Report-a-Bug (team: ${input.reporterTeam})._`);
    return parts.join("\n\n");
};

/**
 * `YYYY-MM-DD` for a MySQL DATE, from **UTC** components (matches the task and
 * sprint serializers — Drizzle materialises a DATE at UTC midnight).
 *
 * F3: was LOCAL components. This is a third hand-rolled copy of
 * `sprintSerializer.formatWireDate`, and the duplication is exactly why the
 * copies could drift apart; they are aligned now. Worth collapsing into the one
 * exported helper next time this file is open — out of F3's scope (rule X5).
 */
const ymd = (d: Date): string => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

const toWireSprint = (s: Sprint): WireSprint => ({
    id: s.id,
    name: s.name,
    goal: s.goal,
    start_date: ymd(s.startDate),
    end_date: ymd(s.endDate),
    status: s.status,
    committed_points: s.committedPoints,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
});

const toWirePostmortem = (p: TaskPostmortem): WirePostmortem => ({
    task_id: p.taskId,
    items: (p.items ?? {}) as Record<string, boolean>,
    updated_by: p.updatedBy,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
});

const isTask = (t: WireTask | null): t is WireTask => t !== null;

/**
 * §22 Engineering specials — domain logic.
 */
export class EngineeringService {
    constructor(
        /** Team-access P3: postmortem save + its audit row commit together. */
        private db: MySql2Database<typeof schema>,
        private repo: EngineeringRepo,
        private taskWrite: TaskWriteService,
        private tasksRepo: TasksRepo,
        private taskActivity: TaskActivityRepo,
        private usersRepo: UsersRepo,
        private logger: Logger,
    ) {}

    /**
     * §22 #1 `POST /api/v1/eng/report-bug` (🔐 any member). Composes a Bug task
     * in the workspace's "Bug Triage" list (resolved by name), letting
     * `TaskWriteService.create` apply the §29 per-severity SLA (it keys on the
     * "Bug" type name) and default the severity to S2 when omitted. The current
     * on-call engineer is auto-assigned ONLY for high-severity bugs (S0/S1) and
     * only when an active engineer is on call this week. Returns the hydrated
     * Task (201). 409 `eng.not_configured` if the workspace lacks a "Bug" task
     * type or a "Bug Triage" list.
     */
    async reportBug(input: ReportBugInput): Promise<WireTask> {
        const bugTaskTypeId = await this.repo.findBugTaskTypeId(
            input.workspaceId,
        );
        if (!bugTaskTypeId) {
            throw AppError.conflict(
                "eng.not_configured",
                'This workspace has no "Bug" task type; create one before reporting bugs',
            );
        }
        const bugList = await this.repo.findBugTriageList(input.workspaceId);
        if (!bugList) {
            throw AppError.conflict(
                "eng.not_configured",
                'This workspace has no "Bug Triage" list; create one before reporting bugs',
            );
        }

        // Auto-assign the current on-call engineer for high-severity bugs only
        // (S0/S1). Decided on the SUPPLIED severity (before create() defaults to
        // S2), and only when an ACTIVE engineer is on call — create() rejects an
        // inactive assignee with 422.
        const severity = input.severity ?? null;
        let assignees: string[] = [];
        if (severity === "S0" || severity === "S1") {
            const onCallId = await this.repo.findCurrentOnCallEngineerId(
                input.workspaceId,
            );
            if (onCallId) assignees = [onCallId];
        }

        // F28 (ISS-094, D12.1): run the insert under the NAMED intake principal.
        // The route gate (`bug.report`) is the authority for this flow — every
        // role holds that key because reporting a bug is how a non-engineer
        // reaches the team — but `create()` asserts `task.create`, which the
        // Guest role no longer holds. Without this block a guest's bug.report
        // grant opened no door: the route admitted, the service 403'd.
        // Attribution is untouched — created_by / activity / notifications all
        // flow from `input.actorId` below. See rbac/principals.ts §2b.
        const task = await runWithPrincipal(
            bugIntakePrincipal({
                workspaceId: input.workspaceId,
                spaceId: bugList.spaceId,
                listId: bugList.id,
                reporterId: input.actorId,
            }),
            () =>
                this.taskWrite.create({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    role: input.role,
                    primaryListId: bugList.id,
                    taskTypeId: bugTaskTypeId,
                    name: deriveTitle(input.happened, input.steps),
                    description: composeDescription(input),
                    bugSeverity: severity, // null → create() defaults a Bug to S2
                    reporterTeam: input.reporterTeam,
                    assignees,
                }),
        );

        this.logger.debug("eng.report_bug.created", {
            workspaceId: input.workspaceId,
            taskId: task.id,
            severity: task.bug_severity,
            assigned: assignees.length > 0,
        });

        return task;
    }

    /**
     * §22 #2 `GET /api/v1/eng/home` (🔐 any member). The Engineering dashboard in
     * one round-trip: open-bug / open-incident counts + previews, the caller's
     * active-sprint tasks, PRs awaiting their review, stale tickets, the current
     * on-call engineer, and the active sprint. All task previews are batch-
     * hydrated once (no N+1). Buckets are workspace-scoped and resolve Bug /
     * Incident types BY NAME (the literal-id `_post.sql` views are bypassed).
     */
    async getHome(input: EngHomeInput): Promise<EngHome> {
        const { workspaceId, userId, role } = input;

        const [activeSprint, bugTypeId, incidentTypeId] = await Promise.all([
            this.repo.activeSprint(workspaceId),
            this.repo.findBugTaskTypeId(workspaceId),
            this.repo.findIncidentTaskTypeId(workspaceId),
        ]);

        const [openBugs, openIncidents, mySprintIds, prsIds, staleIds] =
            await Promise.all([
                bugTypeId
                    ? this.repo.openCountAndTopByType(
                          workspaceId,
                          bugTypeId,
                          TOP_LIMIT,
                      )
                    : Promise.resolve({ count: 0, topIds: [] as string[] }),
                incidentTypeId
                    ? this.repo.openCountAndTopByType(
                          workspaceId,
                          incidentTypeId,
                          TOP_LIMIT,
                      )
                    : Promise.resolve({ count: 0, topIds: [] as string[] }),
                activeSprint
                    ? this.repo.mySprintTaskIds(
                          workspaceId,
                          activeSprint.id,
                          userId,
                          BUCKET_LIMIT,
                      )
                    : Promise.resolve([] as string[]),
                this.repo.prsAwaitingMeIds(workspaceId, userId, BUCKET_LIMIT),
                this.repo.staleTicketIds(workspaceId, BUCKET_LIMIT),
            ]);

        // Batch-hydrate every referenced task once (no N+1 across the buckets).
        const allIds = [
            ...new Set([
                ...openBugs.topIds,
                ...openIncidents.topIds,
                ...mySprintIds,
                ...prsIds,
                ...staleIds,
            ]),
        ];
        const toWire = await this.buildTaskHydrator(allIds, workspaceId, role);

        let currentOnCall: WireUser | null = null;
        const onCallId =
            await this.repo.findCurrentOnCallEngineerId(workspaceId);
        if (onCallId) {
            const u = await this.usersRepo.findByIdInWorkspace(
                onCallId,
                workspaceId,
            );
            if (u) currentOnCall = toWireUser(u);
        }

        return {
            open_bugs: {
                count: openBugs.count,
                top: openBugs.topIds.map(toWire).filter(isTask),
            },
            my_sprint_tasks: mySprintIds.map(toWire).filter(isTask),
            prs_awaiting_me: prsIds.map(toWire).filter(isTask),
            open_incidents: {
                count: openIncidents.count,
                top: openIncidents.topIds.map(toWire).filter(isTask),
            },
            stale_tickets: staleIds.map(toWire).filter(isTask),
            current_on_call: currentOnCall,
            active_sprint: activeSprint ? toWireSprint(activeSprint) : null,
        };
    }

    /**
     * §22 #3 `POST /api/v1/eng/incidents/:id/postmortem` (🔐 any member). Saves
     * (upserts) the postmortem checklist (`items: label → boolean`) for a
     * resolved Incident task. Rejects unless the task is an "Incident" type
     * (409 `incident.not_incident`) AND its status is in the done/closed group
     * (409 `incident.not_resolved`); 404 `task.not_found` for an unknown /
     * cross-workspace id. Returns the saved postmortem (200).
     */
    async submitPostmortem(
        input: SubmitPostmortemInput,
    ): Promise<WirePostmortem> {
        const state = await this.repo.findIncidentTaskState(
            input.incidentId,
            input.workspaceId,
        );
        if (!state) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.incidentId} does not exist`,
            );
        }
        if (state.typeName.trim().toLowerCase() !== "incident") {
            throw AppError.conflict(
                "incident.not_incident",
                "Postmortems can only be submitted on Incident tasks",
            );
        }
        if (!POSTMORTEM_STATUS_GROUPS.has(state.statusGroup)) {
            throw AppError.conflict(
                "incident.not_resolved",
                "Postmortems can only be submitted on a resolved (done or closed) Incident",
            );
        }

        // Team-access P3 (plan G13): the postmortem save was invisible to the
        // task's audit log (a winston debug line was the only witness). The
        // upsert + its row + the ETag bump commit together; `revised` says
        // whether this replaced an earlier submission.
        const existed = (await this.repo.findPostmortem(state.id)) !== null;
        await this.db.transaction(async (tx) => {
            await this.repo.upsertPostmortem(
                state.id,
                input.items,
                input.actorId,
                tx,
            );
            await this.taskActivity.recordMany(
                [
                    {
                        taskId: state.id,
                        actorId: input.actorId,
                        action: "postmortem_submitted",
                        context: {
                            items: Object.keys(input.items).length,
                            revised: existed,
                        },
                    },
                ],
                tx,
            );
            await this.tasksRepo.touchUpdatedAt(state.id, tx);
        });
        const row = await this.repo.findPostmortem(state.id);
        if (!row) {
            throw AppError.internal("Failed to persist the postmortem");
        }

        this.logger.debug("eng.postmortem.saved", {
            workspaceId: input.workspaceId,
            taskId: state.id,
            itemCount: Object.keys(input.items).length,
        });

        return toWirePostmortem(row);
    }

    /**
     * §22 companion read `GET /api/v1/eng/incidents/:id/postmortem` (🔐 any
     * member) — gap-scan H5: the checklist UI persists server-side now and
     * needs to REHYDRATE. 404 `task.not_found` for unknown/cross-workspace
     * ids; a task with nothing saved yet returns an EMPTY items map (200,
     * null timestamps) so the client has no 404 special-case. No
     * type/status gate — reading is harmless and the drawer already gates
     * rendering to resolved Incidents.
     */
    async getPostmortem(input: {
        workspaceId: string;
        incidentId: string;
    }): Promise<WirePostmortem> {
        const state = await this.repo.findIncidentTaskState(
            input.incidentId,
            input.workspaceId,
        );
        if (!state) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.incidentId} does not exist`,
            );
        }
        const row = await this.repo.findPostmortem(state.id);
        if (!row) {
            return {
                task_id: state.id,
                items: {},
                updated_by: null,
                created_at: null,
                updated_at: null,
            };
        }
        return toWirePostmortem(row);
    }

    /**
     * Fetch + batch-hydrate the given task ids once, returning a lookup that maps
     * an id to its wire `Task` (or null if it was not found in the workspace).
     * Mirrors the read-side hydration (`assignees`/`watchers`/`tags`/custom-field
     * values, guest-redacted) so the previews are byte-identical to a GET.
     */
    private async buildTaskHydrator(
        ids: string[],
        workspaceId: string,
        role: Role,
    ): Promise<(id: string) => WireTask | null> {
        if (ids.length === 0) return () => null;
        const rows = await this.tasksRepo.findManyByIdsInWorkspace(
            ids,
            workspaceId,
        );
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        const redactGuest = role === Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] =
            await Promise.all([
                this.tasksRepo.assigneesByTask(ids),
                this.tasksRepo.watchersByTask(ids),
                this.tasksRepo.tagsByTask(ids),
                this.tasksRepo.customFieldValuesByTask(ids, redactGuest),
            ]);
        return (id: string): WireTask | null => {
            const row = rowMap.get(id);
            if (!row) return null;
            return toWireTask(row, {
                assignees: assignees.get(id) ?? [],
                watchers: watchers.get(id) ?? [],
                tags: tags.get(id) ?? [],
                customFieldValues: customFieldValues.get(id) ?? {},
            });
        };
    }
}
