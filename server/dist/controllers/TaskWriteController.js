"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskWriteController = void 0;
const express_validator_1 = require("express-validator");
const errors_1 = require("../errors");
/**
 * §10 Tasks HTTP layer (write side). Translates the validated body into a
 * service call and the resulting wire `Task` into the spec response, setting the
 * `ETag` header (the task's `updated_at`, per Appendix A) so clients can echo it
 * in `If-Match` on the next PATCH.
 */
/**
 * Genuinely-nullable `tasks` columns a client may CLEAR via `PATCH { field: null }`.
 * `matchedData` silently drops explicit-null optional fields, so without this a
 * null-only clear (e.g. `{ due_date: null }`) reads as an empty body → 422. We
 * re-include only these (never NOT-NULL columns like name/status_id/priority,
 * which must not be nulled) — snake_case body keys, verified against the schema.
 */
const NULLABLE_TASK_PATCH_FIELDS = [
    "custom_id",
    "description",
    "start_date",
    "due_date",
    "recurrence_days",
    "recurrence_ends_at",
    "time_estimate_seconds",
    "sprint_id",
    "story_points",
    "reviewer_id",
    "branch_name",
    "pr_url",
    "pr_status",
    "bug_severity",
    "bug_reproducibility",
    "bug_environment",
    "bug_browser",
    "reporter_team",
    "deployed_at",
    "rollback_reason",
];
class TaskWriteController {
    writes;
    logger;
    constructor(writes, logger) {
        this.writes = writes;
        this.logger = logger;
    }
    /**
     * POST /api/v1/tasks — create a task (🔐 any member).
     *
     * Only the validated, sanitized fields are forwarded; identity and workspace
     * scope come from the verified token (`req.auth`), never the body. Returns
     * 201 with the fully-hydrated `Task` and an `ETag` header.
     */
    async create(req, res, next) {
        try {
            const b = (0, express_validator_1.matchedData)(req, {
                locations: ["body"],
            });
            const task = await this.writes.create({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
                primaryListId: b.primary_list_id,
                name: b.name,
                description: b.description,
                statusId: b.status_id,
                taskTypeId: b.task_type_id,
                parentTaskId: b.parent_task_id,
                priority: b.priority,
                isMilestone: b.is_milestone,
                customId: b.custom_id,
                startDate: b.start_date,
                dueDate: b.due_date,
                recurrencePattern: b.recurrence_pattern,
                recurrenceDays: b.recurrence_days,
                recurrenceEndsAt: b.recurrence_ends_at,
                timeEstimateSeconds: b.time_estimate_seconds,
                assignees: b.assignees,
                tags: b.tags,
                sprintId: b.sprint_id,
                storyPoints: b.story_points,
                reviewerId: b.reviewer_id,
                branchName: b.branch_name,
                prUrl: b.pr_url,
                prStatus: b.pr_status,
                bugSeverity: b.bug_severity,
                bugReproducibility: b.bug_reproducibility,
                bugEnvironment: b.bug_environment,
                bugBrowser: b.bug_browser,
                reporterTeam: b.reporter_team,
                deployedAt: b.deployed_at,
                rollbackReason: b.rollback_reason,
            });
            this.logger.info("tasks.create.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: task.id,
            });
            res.setHeader("ETag", task.updated_at);
            res.status(201).json(task);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * PATCH /api/v1/tasks/:id — update a task's scalar fields (🔐 any member).
     *
     * At least one field must be present (else 422). An optional `If-Match`
     * header carries the ETag for optimistic concurrency (409 `task.conflict` on
     * mismatch). Returns 200 with the updated `Task` and a fresh ETag.
     */
    async update(req, res, next) {
        try {
            const { id } = (0, express_validator_1.matchedData)(req, { locations: ["params"] });
            const b = (0, express_validator_1.matchedData)(req, {
                locations: ["body"],
            });
            // `matchedData` drops explicit-null optional fields, so a PATCH that
            // CLEARS a nullable column would look empty. Re-include the nulls the
            // client actually sent (restricted to genuinely-nullable columns) so
            // e.g. `{ due_date: null }` clears the due date instead of 422-ing.
            const rawBody = (req.body ?? {});
            for (const k of NULLABLE_TASK_PATCH_FIELDS) {
                if (rawBody[k] === null && !(k in b)) {
                    b[k] = null;
                }
            }
            const fields = Object.keys(b);
            if (fields.length === 0) {
                throw errors_1.AppError.validationFailed([
                    { issue: "Provide at least one field to update" },
                ]);
            }
            const ifMatchHeader = req.headers["if-match"];
            const ifMatch = typeof ifMatchHeader === "string" ? ifMatchHeader : undefined;
            const task = await this.writes.update({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
                taskId: id,
                ifMatch,
                fields,
                patch: {
                    name: b.name,
                    description: b.description,
                    statusId: b.status_id,
                    priority: b.priority,
                    taskTypeId: b.task_type_id,
                    isMilestone: b.is_milestone,
                    customId: b.custom_id,
                    startDate: b.start_date,
                    dueDate: b.due_date,
                    recurrencePattern: b.recurrence_pattern,
                    recurrenceDays: b.recurrence_days,
                    recurrenceEndsAt: b.recurrence_ends_at,
                    timeEstimateSeconds: b.time_estimate_seconds,
                    sprintId: b.sprint_id,
                    storyPoints: b.story_points,
                    reviewerId: b.reviewer_id,
                    branchName: b.branch_name,
                    prUrl: b.pr_url,
                    prStatus: b.pr_status,
                    bugSeverity: b.bug_severity,
                    bugReproducibility: b.bug_reproducibility,
                    bugEnvironment: b.bug_environment,
                    bugBrowser: b.bug_browser,
                    reporterTeam: b.reporter_team,
                    deployedAt: b.deployed_at,
                    rollbackReason: b.rollback_reason,
                },
            });
            this.logger.info("tasks.update.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: task.id,
                fields,
            });
            res.setHeader("ETag", task.updated_at);
            res.status(200).json(task);
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/tasks/:id/archive — soft-delete (cascades to subtasks). 204. */
    async archive(req, res, next) {
        try {
            const { id } = (0, express_validator_1.matchedData)(req, { locations: ["params"] });
            await this.writes.archive({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: id,
            });
            this.logger.info("tasks.archive.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: id,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/tasks/:id/unarchive — restore the subtree. 204. */
    async unarchive(req, res, next) {
        try {
            const { id } = (0, express_validator_1.matchedData)(req, { locations: ["params"] });
            await this.writes.unarchive({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: id,
            });
            this.logger.info("tasks.unarchive.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: id,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * DELETE /api/v1/tasks/:id — soft by default (🔐), or permanent when
     * `?hard=true` (👑 admin/owner; the role gate is in the service). 204.
     */
    async del(req, res, next) {
        try {
            const { id } = (0, express_validator_1.matchedData)(req, { locations: ["params"] });
            const hard = req.query.hard === "true";
            await this.writes.del({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
                taskId: id,
                hard,
            });
            this.logger.info("tasks.delete.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: id,
                hard,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/tasks/bulk — bulk-edit up to 200 tasks (🔐). The validator
     * checks `ids` + per-key patch types; here we reject unknown patch keys and
     * an empty patch (422), then delegate the fail-atomic write to the service.
     * Reads the validated `req.body` (the nested `patch` object is sanitized in
     * place by the validator). Returns 200 `{ updated, tasks }`.
     */
    async bulk(req, res, next) {
        try {
            const body = (req.body ?? {});
            const ids = body.ids ?? [];
            const rawPatch = body.patch ?? {};
            const KNOWN = new Set([
                "status_id",
                "priority",
                "due_date",
                "start_date",
                "sprint_id",
                "archived_at",
                "assignee_add",
                "assignee_remove",
                "tag_add",
                "tag_remove",
            ]);
            const unknown = Object.keys(rawPatch).filter((k) => !KNOWN.has(k));
            if (unknown.length > 0) {
                throw errors_1.AppError.validationFailed([
                    {
                        field: "patch",
                        issue: `unknown patch key(s): ${unknown.join(", ")}`,
                    },
                ]);
            }
            if (Object.keys(rawPatch).length === 0) {
                throw errors_1.AppError.validationFailed([
                    { field: "patch", issue: "at least one patch field is required" },
                ]);
            }
            const result = await this.writes.bulk({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
                ids,
                patch: {
                    statusId: rawPatch.status_id,
                    priority: rawPatch.priority,
                    dueDate: rawPatch.due_date,
                    startDate: rawPatch.start_date,
                    sprintId: rawPatch.sprint_id,
                    archivedAtProvided: "archived_at" in rawPatch,
                    archivedAt: rawPatch.archived_at,
                    assigneeAdd: rawPatch.assignee_add,
                    assigneeRemove: rawPatch.assignee_remove,
                    tagAdd: rawPatch.tag_add,
                    tagRemove: rawPatch.tag_remove,
                },
            });
            this.logger.info("tasks.bulk.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                updated: result.updated,
            });
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/tasks/my-work — the caller's task dashboard (🔐). Returns the
     * five buckets (today/overdue/next/unscheduled/done), or only `?bucket=<x>`.
     */
    async myWork(req, res, next) {
        try {
            const { bucket } = (0, express_validator_1.matchedData)(req, { locations: ["query"] });
            const result = await this.writes.myWork({
                workspaceId: req.auth.workspaceId,
                userId: req.auth.sub,
                role: req.auth.role,
                bucket,
            });
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    }
}
exports.TaskWriteController = TaskWriteController;
