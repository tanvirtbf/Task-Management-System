"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineeringService = void 0;
const errors_1 = require("../errors");
const constants_1 = require("../constants");
const taskSerializer_1 = require("../serializers/taskSerializer");
const userSerializer_1 = require("../serializers/userSerializer");
const TITLE_MAX = 120;
/** Newest items shown in the open-bugs / open-incidents tiles (count is full). */
const TOP_LIMIT = 5;
/** Cap for the my-sprint / prs-awaiting / stale-tickets lists. */
const BUCKET_LIMIT = 25;
/** A postmortem may only be submitted once an Incident is in one of these. */
const POSTMORTEM_STATUS_GROUPS = new Set(["done", "closed"]);
/** First non-empty line of `primary`, then `secondary`; capped; safe fallback. */
const deriveTitle = (primary, secondary) => {
    const firstLine = (s) => {
        for (const line of s.split("\n")) {
            const t = line.trim();
            if (t.length > 0)
                return t;
        }
        return "";
    };
    const title = firstLine(primary) || firstLine(secondary) || "Bug report";
    return title.length > TITLE_MAX
        ? `${title.slice(0, TITLE_MAX - 1)}…`
        : title;
};
/** Compose a readable markdown bug description from the intake fields. */
const composeDescription = (input) => {
    const parts = [
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
/** Local `YYYY-MM-DD` for a MySQL DATE (matches the task serializer). */
const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};
const toWireSprint = (s) => ({
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
const toWirePostmortem = (p) => ({
    task_id: p.taskId,
    items: (p.items ?? {}),
    updated_by: p.updatedBy,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
});
const isTask = (t) => t !== null;
/**
 * §22 Engineering specials — domain logic.
 */
class EngineeringService {
    repo;
    taskWrite;
    tasksRepo;
    usersRepo;
    logger;
    constructor(repo, taskWrite, tasksRepo, usersRepo, logger) {
        this.repo = repo;
        this.taskWrite = taskWrite;
        this.tasksRepo = tasksRepo;
        this.usersRepo = usersRepo;
        this.logger = logger;
    }
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
    async reportBug(input) {
        const bugTaskTypeId = await this.repo.findBugTaskTypeId(input.workspaceId);
        if (!bugTaskTypeId) {
            throw errors_1.AppError.conflict("eng.not_configured", 'This workspace has no "Bug" task type; create one before reporting bugs');
        }
        const bugListId = await this.repo.findBugTriageListId(input.workspaceId);
        if (!bugListId) {
            throw errors_1.AppError.conflict("eng.not_configured", 'This workspace has no "Bug Triage" list; create one before reporting bugs');
        }
        // Auto-assign the current on-call engineer for high-severity bugs only
        // (S0/S1). Decided on the SUPPLIED severity (before create() defaults to
        // S2), and only when an ACTIVE engineer is on call — create() rejects an
        // inactive assignee with 422.
        const severity = input.severity ?? null;
        let assignees = [];
        if (severity === "S0" || severity === "S1") {
            const onCallId = await this.repo.findCurrentOnCallEngineerId(input.workspaceId);
            if (onCallId)
                assignees = [onCallId];
        }
        const task = await this.taskWrite.create({
            workspaceId: input.workspaceId,
            actorId: input.actorId,
            role: input.role,
            primaryListId: bugListId,
            taskTypeId: bugTaskTypeId,
            name: deriveTitle(input.happened, input.steps),
            description: composeDescription(input),
            bugSeverity: severity, // null → create() defaults a Bug to S2
            reporterTeam: input.reporterTeam,
            assignees,
        });
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
    async getHome(input) {
        const { workspaceId, userId, role } = input;
        const [activeSprint, bugTypeId, incidentTypeId] = await Promise.all([
            this.repo.activeSprint(workspaceId),
            this.repo.findBugTaskTypeId(workspaceId),
            this.repo.findIncidentTaskTypeId(workspaceId),
        ]);
        const [openBugs, openIncidents, mySprintIds, prsIds, staleIds] = await Promise.all([
            bugTypeId
                ? this.repo.openCountAndTopByType(workspaceId, bugTypeId, TOP_LIMIT)
                : Promise.resolve({ count: 0, topIds: [] }),
            incidentTypeId
                ? this.repo.openCountAndTopByType(workspaceId, incidentTypeId, TOP_LIMIT)
                : Promise.resolve({ count: 0, topIds: [] }),
            activeSprint
                ? this.repo.mySprintTaskIds(workspaceId, activeSprint.id, userId, BUCKET_LIMIT)
                : Promise.resolve([]),
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
        let currentOnCall = null;
        const onCallId = await this.repo.findCurrentOnCallEngineerId(workspaceId);
        if (onCallId) {
            const u = await this.usersRepo.findByIdInWorkspace(onCallId, workspaceId);
            if (u)
                currentOnCall = (0, userSerializer_1.toWireUser)(u);
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
    async submitPostmortem(input) {
        const state = await this.repo.findIncidentTaskState(input.incidentId, input.workspaceId);
        if (!state) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.incidentId} does not exist`);
        }
        if (state.typeName.trim().toLowerCase() !== "incident") {
            throw errors_1.AppError.conflict("incident.not_incident", "Postmortems can only be submitted on Incident tasks");
        }
        if (!POSTMORTEM_STATUS_GROUPS.has(state.statusGroup)) {
            throw errors_1.AppError.conflict("incident.not_resolved", "Postmortems can only be submitted on a resolved (done or closed) Incident");
        }
        await this.repo.upsertPostmortem(state.id, input.items, input.actorId);
        const row = await this.repo.findPostmortem(state.id);
        if (!row) {
            throw errors_1.AppError.internal("Failed to persist the postmortem");
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
    async getPostmortem(input) {
        const state = await this.repo.findIncidentTaskState(input.incidentId, input.workspaceId);
        if (!state) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.incidentId} does not exist`);
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
    async buildTaskHydrator(ids, workspaceId, role) {
        if (ids.length === 0)
            return () => null;
        const rows = await this.tasksRepo.findManyByIdsInWorkspace(ids, workspaceId);
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        const redactGuest = role === constants_1.Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] = await Promise.all([
            this.tasksRepo.assigneesByTask(ids),
            this.tasksRepo.watchersByTask(ids),
            this.tasksRepo.tagsByTask(ids),
            this.tasksRepo.customFieldValuesByTask(ids, redactGuest),
        ]);
        return (id) => {
            const row = rowMap.get(id);
            if (!row)
                return null;
            return (0, taskSerializer_1.toWireTask)(row, {
                assignees: assignees.get(id) ?? [],
                watchers: watchers.get(id) ?? [],
                tags: tags.get(id) ?? [],
                customFieldValues: customFieldValues.get(id) ?? {},
            });
        };
    }
}
exports.EngineeringService = EngineeringService;
