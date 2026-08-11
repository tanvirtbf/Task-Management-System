"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAssignmentGate = exports.assignmentGate = exports.AssignmentRequestsService = void 0;
const logger_1 = __importDefault(require("../config/logger"));
const client_1 = require("../db/client");
const errors_1 = require("../errors");
const can_1 = require("../rbac/can");
const policy_1 = require("../rbac/policy");
const scopeGuard_1 = require("../rbac/scopeGuard");
const AssignmentRequestsRepo_1 = require("../repositories/AssignmentRequestsRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const UserRolesRepo_1 = require("../repositories/UserRolesRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const TaskEmailService_1 = require("./TaskEmailService");
const PushService_1 = require("./PushService");
const utils_1 = require("../utils");
// =============================================================================
// Cross-team assignment approval (team-access P8 — R1.4/R1.5).
//
// THE GATE (Q11): an assignment needs approval exactly when the person being
// assigned is NOT a member of the space that owns the task. Membership decides
// — not home team — so someone who genuinely belongs to two teams is handled
// with no special case. Three carve-outs keep the gate honest and DORMANT
// until the visibility switch:
//
//   · requester === target — you consent by asking (self-assignment),
//   · the target's `task.view` reach is `all` — a person who already sees the
//     whole board is not being conscripted across a boundary they can't see.
//     This is what keeps every open-seed install (and the whole jest suite)
//     instant: until upgrade 019 narrows Member/Guest, everyone folds to
//     `all`. Admin/Owner stay instant forever (Q4),
//   · the S0/S1 on-call auto-assign (Q7) — a page that waits for an accept is
//     not a page. `CreateTaskInput.exemptAssignmentApproval`, set ONLY by
//     `EngineeringService.reportBug`.
//
// THE NEGOTIATION: pending → accepted | declined | cancelled | expired, all
// four flips atomic claims (`WHERE status='pending'` — the overdue-alert
// pattern), so a double-click or a racing janitor can never double-fire.
// `query` (the receiver: "I need 2 more days" + proposed date) and `answer`
// (the requester replies, optionally moving the real due date) leave the row
// pending — the receiver still owns the final accept. Deciders (Q2/B6): the
// target, any Head of a team the target belongs to, or an admin — but NEVER
// the requester, admin or not: approval exists so the receiving side consents,
// and a requester accepting their own ask would be conscription with extra
// steps.
//
// FIX B2 (the deadlock the plan review caught): after upgrade 020 the
// requester holds no `task.edit` on the task, so answering a query must NOT be
// a generic task edit. `answer()` is authorised as "you are the requester of
// this pending request"; the date change is delegated to a `DueDateChanger`
// the ROUTER wires (TaskWriteService.update under the narrow negotiation
// principal), so validation, the audit diff row, the ETag bump and the
// overdue-alert re-arm all fire exactly as a normal edit — only the
// authorisation differs. The service deliberately does NOT import
// TaskWriteService: TaskWriteService/TaskMembershipService import the
// `assignmentGate()` singleton below, and a module cycle here would break
// both.
// =============================================================================
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Q6 — 7 days
const LIST_LIMIT = 100;
const NOTIFICATION_TITLE_MAX = 300; // notifications.title VARCHAR(300)
const notifTitle = (prefix, taskName) => {
    const room = NOTIFICATION_TITLE_MAX - prefix.length;
    const name = taskName.length > room
        ? `${taskName.slice(0, room - 1)}…`
        : taskName;
    return `${prefix}${name}`;
};
class AssignmentRequestsService {
    db;
    repo;
    tasks;
    membership;
    activity;
    notifications;
    users;
    userRoles;
    policy;
    logger;
    dueDateChanger;
    constructor(db, repo, tasks, membership, activity, notifications, users, userRoles, policy, logger, 
    /** Router-wired; absent on the gate singleton (which never answers). */
    dueDateChanger) {
        this.db = db;
        this.repo = repo;
        this.tasks = tasks;
        this.membership = membership;
        this.activity = activity;
        this.notifications = notifications;
        this.users = users;
        this.userRoles = userRoles;
        this.policy = policy;
        this.logger = logger;
        this.dueDateChanger = dueDateChanger;
    }
    // ─── the gate ────────────────────────────────────────────────────────────
    /**
     * Classify every (task, person) assignment: direct, or approval-gated.
     * Read-only — call BEFORE the write transaction. The policy fold is cached
     * per (user, permissions_version), and the membership probe is one indexed
     * query per distinct (user, space) pair, so the dormant hot path costs
     * almost nothing beyond what assignment validation already paid.
     */
    async splitByApproval(input) {
        const directByTask = new Map();
        const gated = [];
        const pushDirect = (p) => {
            const list = directByTask.get(p.taskId) ?? [];
            list.push(p.targetUserId);
            directByTask.set(p.taskId, list);
        };
        if (input.exempt || input.pairs.length === 0) {
            for (const p of input.pairs)
                pushDirect(p);
            return { directByTask, gated, headsByTarget: new Map() };
        }
        // One fold per distinct target — `all` reach means "not conscriptable
        // across a boundary they can't see" (and is every seeded role today).
        const reachAll = new Map();
        for (const uid of new Set(input.pairs.map((p) => p.targetUserId))) {
            if (uid === input.requesterId) {
                reachAll.set(uid, true); // self-assign — consent by asking
                continue;
            }
            const actor = await this.policy.resolveActor(uid, input.workspaceId);
            reachAll.set(uid, actor ? (0, can_1.entryFor)(actor, "task.view").all : true);
        }
        // Q11 — one membership probe per distinct (user, space) pair.
        const membership = new Map();
        for (const p of input.pairs) {
            if (!p.spaceId || reachAll.get(p.targetUserId))
                continue;
            const key = `${p.targetUserId}|${p.spaceId}`;
            if (membership.has(key))
                continue;
            membership.set(key, await this.userRoles.hasSpaceMembership(p.targetUserId, p.spaceId, input.workspaceId));
        }
        for (const p of input.pairs) {
            const member = 
            // No resolvable owning space (unreachable for a real task —
            // the list→space chain is NOT NULL) degrades to the legacy
            // direct add rather than a request with a broken FK.
            !p.spaceId ||
                reachAll.get(p.targetUserId) ||
                membership.get(`${p.targetUserId}|${p.spaceId}`);
            if (member)
                pushDirect(p);
            else
                gated.push(p);
        }
        // Head fanout for the gated targets only (Q2: "both are notified").
        const headsByTarget = gated.length > 0
            ? await this.repo.headsOfUserSpaces([...new Set(gated.map((p) => p.targetUserId))], input.workspaceId)
            : new Map();
        return { directByTask, gated, headsByTarget };
    }
    /**
     * Create the pending requests for a gate split — INSIDE the caller's
     * assignment transaction, after the task rows exist and under the same
     * task lock ordering (task first, request rows second — the accept path
     * locks in the same order, so the two can never deadlock). A racing
     * duplicate pending (`uq_tar_one_pending`) is skipped, not an error —
     * "someone already asked" is the idempotent no-op of this domain.
     */
    async createRequestsInTx(tx, input) {
        const { split, now } = input;
        if (split.gated.length === 0)
            return { created: 0 };
        // "Someone already asked" is this domain's idempotent no-op. The
        // read-then-insert is race-safe because every assignment path holds
        // the task row lock before calling in; `uq_tar_one_pending` stays as
        // the loud backstop.
        const alreadyPending = await this.repo.pendingPairs(split.gated, tx);
        const fresh = split.gated.filter((p) => !alreadyPending.has(`${p.taskId}|${p.targetUserId}`));
        if (fresh.length === 0)
            return { created: 0 };
        const expiresAt = new Date(now.getTime() + REQUEST_TTL_MS);
        const created = fresh;
        const createdIds = fresh.map(() => (0, utils_1.fakeId)("areq"));
        await this.repo.insertRequests(fresh.map((pair, i) => ({
            id: createdIds[i],
            workspaceId: input.workspaceId,
            spaceId: pair.spaceId,
            taskId: pair.taskId,
            targetUserId: pair.targetUserId,
            requestedBy: input.requesterId,
            status: "pending",
            requestNote: input.note ?? null,
            expiresAt,
            createdAt: now,
            updatedAt: now,
        })), tx);
        await this.repo.insertEvents(createdIds.map((requestId) => ({
            id: (0, utils_1.fakeId)("arev"),
            requestId,
            actorId: input.requesterId,
            action: "created",
            note: input.note ?? null,
            createdAt: now,
        })), tx);
        // Q2: the target AND their Head(s) are notified; never the requester.
        const rows = created.flatMap((pair) => {
            const recipients = new Set([
                pair.targetUserId,
                ...(split.headsByTarget.get(pair.targetUserId) ?? []),
            ]);
            recipients.delete(input.requesterId);
            return [...recipients].map((userId) => ({
                userId,
                type: "assignment_request",
                entityType: "task",
                entityId: pair.taskId,
                actorId: input.requesterId,
                title: notifTitle("Assignment approval needed: ", pair.taskName),
            }));
        });
        await this.notifications.createMany(rows, tx);
        this.logger.debug("assignment_requests.created", {
            workspaceId: input.workspaceId,
            requesterId: input.requesterId,
            count: created.length,
        });
        return { created: created.length };
    }
    // ─── listing ─────────────────────────────────────────────────────────────
    /** The caller's requests, by box: received / sent / team (Q2 head view). */
    async listFor(input) {
        const { workspaceId, actorId } = input;
        let rows;
        if (input.box === "received") {
            rows = await this.repo.listByTarget(actorId, workspaceId, input.onlyPending, LIST_LIMIT);
        }
        else if (input.box === "sent") {
            rows = await this.repo.listByRequester(actorId, workspaceId, input.onlyPending, LIST_LIMIT);
        }
        else {
            rows = await this.repo.listByHeadOf(actorId, workspaceId, input.onlyPending, LIST_LIMIT);
        }
        return this.hydrate(rows, workspaceId);
    }
    /**
     * The negotiation history of one task (the drawer panel). The route gates
     * the VERB (`task.view`); the OBJECT reach is this resolution through the
     * scope-filtered TasksRepo (with the own-escape) — whoever may read the
     * task may read who was asked to join it, and an out-of-scope id stays a
     * 404, never an existence oracle.
     */
    async listForTask(idOrKey, workspaceId) {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(idOrKey, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${idOrKey} does not exist`);
        }
        const rows = await this.repo.listByTask(task.id, LIST_LIMIT);
        return this.hydrate(rows, workspaceId);
    }
    async hydrate(rows, workspaceId) {
        if (rows.length === 0)
            return [];
        const [snapshots, events] = await Promise.all([
            this.repo.taskSnapshotByIds([...new Set(rows.map((r) => r.taskId))], workspaceId),
            this.repo.eventsByRequests(rows.map((r) => r.id)),
        ]);
        const userIds = new Set();
        for (const r of rows) {
            userIds.add(r.targetUserId);
            userIds.add(r.requestedBy);
            if (r.decidedBy)
                userIds.add(r.decidedBy);
        }
        for (const list of events.values()) {
            for (const e of list)
                if (e.actorId)
                    userIds.add(e.actorId);
        }
        const users = await this.users.findManyByIdsInWorkspace([...userIds], workspaceId);
        const usersById = new Map(users.map((u) => [u.id, u]));
        return rows.map((request) => ({
            request,
            task: snapshots.get(request.taskId) ?? null,
            events: events.get(request.id) ?? [],
            usersById,
        }));
    }
    // ─── the receiver side: accept / decline / query ─────────────────────────
    /**
     * Accept: the atomic claim, then the REAL assignment — assignee row,
     * auto-watch, `assignee_added` audit row, `assigned` notification, ETag
     * bump — the exact side-effect set a direct assignment produces, in one
     * transaction, plus the post-commit email/push. Lock order matches the
     * assignment paths (task row first), so accept and a concurrent direct
     * assign serialize instead of deadlocking.
     */
    async accept(input) {
        const r = await this.requireRequest(input.requestId, input.workspaceId);
        await this.assertDecider(r, input);
        this.assertPendingRead(r);
        const snapshot = await this.requireTask(r);
        const active = await this.users.findActiveIdsInWorkspace([r.targetUserId], input.workspaceId);
        if (!active.has(r.targetUserId)) {
            throw errors_1.AppError.conflict("request.user_inactive", "The requested person is no longer an active member");
        }
        const now = new Date();
        let addedToTask = false;
        await this.db.transaction(async (tx) => {
            await this.tasks.lockById(r.taskId, tx);
            // Re-check under the lock — an archive racing the accept loses.
            const live = await this.repo.taskSnapshotByIds([r.taskId], input.workspaceId, tx);
            if (live.get(r.taskId)?.archivedAt) {
                throw errors_1.AppError.conflict("request.task_archived", "The task has been archived; unarchive it before accepting");
            }
            await this.claimOrThrow(r, tx, {
                to: "accepted",
                decidedBy: input.actorId,
                now,
                requireUnexpired: true,
            });
            const existing = await this.membership.getAssigneeIds(r.taskId, tx);
            if (!existing.includes(r.targetUserId)) {
                await this.membership.addAssignees(r.taskId, [r.targetUserId], input.actorId, tx);
                await this.membership.addWatchers(r.taskId, [r.targetUserId], tx);
                await this.activity.recordMany([
                    {
                        taskId: r.taskId,
                        actorId: input.actorId,
                        action: "assignee_added",
                        context: {
                            user_id: r.targetUserId,
                            via_request: true,
                        },
                    },
                ], tx);
                addedToTask = true;
            }
            await this.repo.insertEvents([
                {
                    id: (0, utils_1.fakeId)("arev"),
                    requestId: r.id,
                    actorId: input.actorId,
                    action: "accepted",
                    note: input.note ?? null,
                    createdAt: now,
                },
            ], tx);
            const rows = [];
            if (r.requestedBy !== input.actorId) {
                rows.push({
                    userId: r.requestedBy,
                    type: "assignment_request_decided",
                    entityType: "task",
                    entityId: r.taskId,
                    actorId: input.actorId,
                    title: notifTitle("Assignment accepted: ", snapshot.name),
                });
            }
            // A Head/admin accepted FOR the target — tell the target the
            // normal way (never notify someone about their own action).
            if (addedToTask && r.targetUserId !== input.actorId) {
                rows.push({
                    userId: r.targetUserId,
                    type: "assigned",
                    entityType: "task",
                    entityId: r.taskId,
                    actorId: input.actorId,
                    title: notifTitle("You were assigned to ", snapshot.name),
                });
            }
            await this.notifications.createMany(rows, tx);
            await this.tasks.touchUpdatedAt(r.taskId, tx);
        });
        // Same out-of-app channels a direct assignment fires, post-commit,
        // fire-and-forget (2026-08-08 notification delivery convention).
        if (addedToTask && r.targetUserId !== input.actorId) {
            void (0, TaskEmailService_1.taskEmails)().taskAssigned({
                workspaceId: input.workspaceId,
                taskId: r.taskId,
                taskName: snapshot.name,
                recipientIds: [r.targetUserId],
                actorId: input.actorId,
                dueYmd: snapshot.dueDate
                    ? snapshot.dueDate.toISOString().slice(0, 10)
                    : null,
            });
            void (0, PushService_1.pushSvc)().taskAssigned({
                workspaceId: input.workspaceId,
                taskId: r.taskId,
                taskName: snapshot.name,
                recipientIds: [r.targetUserId],
                actorId: input.actorId,
            });
        }
        return this.reload(r.id, input.workspaceId);
    }
    /** Decline: the claim + the ledger + "declined" to the requester. */
    async decline(input) {
        const r = await this.requireRequest(input.requestId, input.workspaceId);
        await this.assertDecider(r, input);
        this.assertPendingRead(r);
        const snapshot = await this.requireTask(r);
        const now = new Date();
        await this.db.transaction(async (tx) => {
            await this.claimOrThrow(r, tx, {
                to: "declined",
                decidedBy: input.actorId,
                now,
                requireUnexpired: true,
            });
            await this.repo.insertEvents([
                {
                    id: (0, utils_1.fakeId)("arev"),
                    requestId: r.id,
                    actorId: input.actorId,
                    action: "declined",
                    note: input.note ?? null,
                    createdAt: now,
                },
            ], tx);
            if (r.requestedBy !== input.actorId) {
                await this.notifications.createMany([
                    {
                        userId: r.requestedBy,
                        type: "assignment_request_decided",
                        entityType: "task",
                        entityId: r.taskId,
                        actorId: input.actorId,
                        title: notifTitle("Assignment declined: ", snapshot.name),
                    },
                ], tx);
            }
        });
        return this.reload(r.id, input.workspaceId);
    }
    /**
     * Query — "I need 2 more days": records the note + proposed date on the
     * LIVE pending row (status unchanged; the receiver still owns the final
     * accept) and tells the requester. Receiver-side voices only (Q2).
     */
    async query(input) {
        const r = await this.requireRequest(input.requestId, input.workspaceId);
        await this.assertDecider(r, input);
        this.assertPendingRead(r);
        const snapshot = await this.requireTask(r);
        const now = new Date();
        await this.db.transaction(async (tx) => {
            const recorded = await this.repo.recordQuery(r.id, {
                queryNote: input.note,
                proposedDueDate: input.proposedDueDate ?? null,
                now,
            }, tx);
            if (!recorded)
                throw await this.staleError(r.id, tx, now);
            await this.repo.insertEvents([
                {
                    id: (0, utils_1.fakeId)("arev"),
                    requestId: r.id,
                    actorId: input.actorId,
                    action: "queried",
                    note: input.note,
                    proposedDueDate: input.proposedDueDate ?? null,
                    createdAt: now,
                },
            ], tx);
            if (r.requestedBy !== input.actorId) {
                await this.notifications.createMany([
                    {
                        userId: r.requestedBy,
                        type: "assignment_query",
                        entityType: "task",
                        entityId: r.taskId,
                        actorId: input.actorId,
                        title: notifTitle("Query on assignment: ", snapshot.name),
                    },
                ], tx);
            }
        });
        return this.reload(r.id, input.workspaceId);
    }
    // ─── the requester side: answer / cancel ─────────────────────────────────
    /**
     * Answer a query (fix B2). Authorised as "you are the requester of this
     * pending request" — nothing else; after upgrade 020 the requester
     * typically holds NO edit right on the task, which is exactly why this
     * endpoint exists. A supplied `due_date` is applied through the normal
     * task-update path via the router-wired `DueDateChanger` (validation,
     * `task_updated` audit diff, ETag bump and the overdue-alert re-arm all
     * fire), then the ledger records the reply and the receiver side is told.
     * The request stays PENDING — the receiver still decides.
     */
    async answer(input) {
        const r = await this.requireRequest(input.requestId, input.workspaceId);
        await this.assertParty(r, input);
        if (r.requestedBy !== input.actorId) {
            throw errors_1.AppError.forbidden("request.not_requester", "Only the requester may answer a query on this request");
        }
        this.assertPendingRead(r);
        if (r.expiresAt.getTime() <= Date.now()) {
            throw errors_1.AppError.conflict("request.expired", "This request has expired");
        }
        const snapshot = await this.requireTask(r);
        if (input.dueDate !== undefined) {
            if (!this.dueDateChanger) {
                throw errors_1.AppError.internal("Assignment answers are not wired for date changes here");
            }
            if (snapshot.archivedAt) {
                throw errors_1.AppError.conflict("request.task_archived", "The task has been archived; unarchive it before answering");
            }
            await this.dueDateChanger.apply({
                taskId: r.taskId,
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                actorRole: input.actorRole,
                dueYmd: input.dueDate,
                spaceId: snapshot.spaceId,
                listId: snapshot.listId,
            });
        }
        const now = new Date();
        const lastQueryActor = await this.repo.lastQueryActor(r.id);
        await this.db.transaction(async (tx) => {
            const touched = await this.repo.touchPending(r.id, now, tx);
            if (!touched)
                throw await this.staleError(r.id, tx, now);
            await this.repo.insertEvents([
                {
                    id: (0, utils_1.fakeId)("arev"),
                    requestId: r.id,
                    actorId: input.actorId,
                    action: "answered",
                    note: input.note ?? null,
                    proposedDueDate: input.dueDate ?? null,
                    createdAt: now,
                },
            ], tx);
            const recipients = new Set([r.targetUserId]);
            if (lastQueryActor)
                recipients.add(lastQueryActor);
            recipients.delete(input.actorId);
            await this.notifications.createMany([...recipients].map((userId) => ({
                userId,
                type: "assignment_query",
                entityType: "task",
                entityId: r.taskId,
                actorId: input.actorId,
                title: notifTitle("Query answered: ", snapshot.name),
            })), tx);
        });
        return this.reload(r.id, input.workspaceId);
    }
    /** Withdraw (requester or an admin) — claim to `cancelled`, tell the target. */
    async cancel(input) {
        const r = await this.requireRequest(input.requestId, input.workspaceId);
        await this.assertParty(r, input);
        const legacy = await (0, scopeGuard_1.liveLegacyRole)(input.actorRole);
        const isAdmin = legacy === "owner" || legacy === "admin";
        if (r.requestedBy !== input.actorId && !isAdmin) {
            throw errors_1.AppError.forbidden("request.not_requester", "Only the requester (or an admin) may withdraw this request");
        }
        this.assertPendingRead(r);
        const snapshot = await this.requireTask(r);
        const now = new Date();
        await this.db.transaction(async (tx) => {
            await this.claimOrThrow(r, tx, {
                to: "cancelled",
                decidedBy: input.actorId,
                now,
                requireUnexpired: true,
            });
            await this.repo.insertEvents([
                {
                    id: (0, utils_1.fakeId)("arev"),
                    requestId: r.id,
                    actorId: input.actorId,
                    action: "cancelled",
                    createdAt: now,
                },
            ], tx);
            if (r.targetUserId !== input.actorId) {
                await this.notifications.createMany([
                    {
                        userId: r.targetUserId,
                        type: "assignment_request_decided",
                        entityType: "task",
                        entityId: r.taskId,
                        actorId: input.actorId,
                        title: notifTitle("Assignment request cancelled: ", snapshot.name),
                    },
                ], tx);
            }
        });
        return this.reload(r.id, input.workspaceId);
    }
    // ─── the janitor (Q6) ────────────────────────────────────────────────────
    /**
     * Expire pending requests whose 7-day window lapsed: per row, one
     * transaction — the claim (idempotent; a racing accept wins), the ledger
     * row (actor NULL = the system), and "expired" to the requester. The
     * task is left exactly as it was (the plan: unassigned is the honest
     * outcome of an unanswered ask).
     */
    async expireDue(input) {
        const due = await this.repo.findExpiredPending(input.now, input.limit);
        if (input.dryRun || due.length === 0) {
            return { scanned: due.length, expired: 0 };
        }
        let expired = 0;
        for (const row of due) {
            const didExpire = await this.db.transaction(async (tx) => {
                const claimed = await this.repo.claimDecision(row.id, {
                    to: "expired",
                    decidedBy: null,
                    now: input.now,
                    requireUnexpired: false,
                }, tx);
                if (!claimed)
                    return false;
                await this.repo.insertEvents([
                    {
                        id: (0, utils_1.fakeId)("arev"),
                        requestId: row.id,
                        actorId: null,
                        action: "expired",
                        createdAt: input.now,
                    },
                ], tx);
                await this.notifications.createMany([
                    {
                        userId: row.requestedBy,
                        type: "assignment_request_decided",
                        entityType: "task",
                        entityId: row.taskId,
                        actorId: null,
                        title: notifTitle("Assignment request expired: ", row.taskName ?? "(deleted task)"),
                    },
                ], tx);
                return true;
            });
            if (didExpire)
                expired += 1;
        }
        return { scanned: due.length, expired };
    }
    // ─── guards ──────────────────────────────────────────────────────────────
    async requireRequest(id, workspaceId) {
        const r = await this.repo.findByIdInWorkspace(id, workspaceId);
        if (!r) {
            throw errors_1.AppError.notFound("request.not_found", "Assignment request not found");
        }
        return r;
    }
    async requireTask(r) {
        const map = await this.repo.taskSnapshotByIds([r.taskId], r.workspaceId);
        const snapshot = map.get(r.taskId);
        if (!snapshot) {
            // The FK cascade removes requests with their task; between the
            // request read and here the task vanished — treat as gone.
            throw errors_1.AppError.notFound("request.not_found", "Assignment request not found");
        }
        return snapshot;
    }
    /**
     * Who may even KNOW this request exists: the requester, the target, a
     * Head of one of the target's teams, or an admin. Anyone else gets the
     * same 404 a wrong id gets — the endpoint is never an existence oracle.
     */
    async assertParty(r, input) {
        const legacy = await (0, scopeGuard_1.liveLegacyRole)(input.actorRole);
        const isAdmin = legacy === "owner" || legacy === "admin";
        const heads = (await this.repo.headsOfUserSpaces([r.targetUserId], input.workspaceId)).get(r.targetUserId) ?? [];
        const isDecider = input.actorId === r.targetUserId ||
            heads.includes(input.actorId) ||
            isAdmin;
        const isParty = isDecider || input.actorId === r.requestedBy;
        if (!isParty) {
            throw errors_1.AppError.notFound("request.not_found", "Assignment request not found");
        }
        return { isDecider };
    }
    /**
     * Q2 + B6: the target accepts their own work; their Head may decide for
     * the team; an admin may always step in; a team with no Head simply
     * leaves the target as the only voice. The REQUESTER never decides —
     * admin or not — or approval would be conscription with extra steps.
     */
    async assertDecider(r, input) {
        const { isDecider } = await this.assertParty(r, input);
        if (input.actorId === r.requestedBy &&
            input.actorId !== r.targetUserId) {
            throw errors_1.AppError.forbidden("request.not_decider", "The requester cannot decide their own request");
        }
        if (!isDecider) {
            throw errors_1.AppError.forbidden("request.not_decider", "Only the requested person, their team head or an admin may decide this request");
        }
    }
    /** Friendly pre-checks on the row as read (the claim is the authority). */
    assertPendingRead(r) {
        if (r.status !== "pending") {
            throw errors_1.AppError.conflict("request.already_decided", `This request was already ${r.status}`);
        }
    }
    async claimOrThrow(r, tx, input) {
        const claimed = await this.repo.claimDecision(r.id, input, tx);
        if (!claimed)
            throw await this.staleError(r.id, tx, input.now);
    }
    /** Why did the conditional UPDATE miss? Decided vs expired, precisely. */
    async staleError(id, tx, now) {
        const fresh = await this.repo.findById(id, tx);
        if (fresh && fresh.status !== "pending") {
            return errors_1.AppError.conflict("request.already_decided", `This request was already ${fresh.status}`);
        }
        if (fresh && fresh.expiresAt.getTime() <= now.getTime()) {
            return errors_1.AppError.conflict("request.expired", "This request has expired");
        }
        return errors_1.AppError.conflict("request.already_decided", "This request was already decided");
    }
    async reload(id, workspaceId) {
        const r = await this.requireRequest(id, workspaceId);
        const [detail] = await this.hydrate([r], workspaceId);
        return detail;
    }
}
exports.AssignmentRequestsService = AssignmentRequestsService;
// ─── the gate singleton (the `pushSvc()` pattern) ────────────────────────────
// `TaskWriteService` (create + bulk) and `TaskMembershipService` (addAssignees)
// call in from inside their own flows; constructor-injecting a full instance
// at every wiring site would grow four DI lists for one always-identical
// dependency graph — and importing TaskWriteService HERE would close a module
// cycle. The singleton carries no DueDateChanger (it never answers); the
// router builds its own fully-wired instance for the lifecycle endpoints.
let gateInstance = null;
const assignmentGate = () => {
    if (!gateInstance) {
        const db = (0, client_1.getDb)();
        gateInstance = new AssignmentRequestsService(db, new AssignmentRequestsRepo_1.AssignmentRequestsRepo(db), new TasksRepo_1.TasksRepo(db), new TaskMembershipRepo_1.TaskMembershipRepo(db), new TaskActivityRepo_1.TaskActivityRepo(db), new NotificationsRepo_1.NotificationsRepo(db), new UsersRepo_1.UsersRepo(db), new UserRolesRepo_1.UserRolesRepo(db), (0, policy_1.getPolicy)(), logger_1.default);
    }
    return gateInstance;
};
exports.assignmentGate = assignmentGate;
/** Test hook — mirrors PushService's reset so suites can re-seed cleanly. */
const resetAssignmentGate = () => {
    gateInstance = null;
};
exports.resetAssignmentGate = resetAssignmentGate;
