/**
 * Shared TypeScript types for the entire client app.
 * These mirror the backend models so swapping mock data for real API
 * is a one-line change later.
 */

// ============================================================
// Identity
// ============================================================

export type Role = "owner" | "admin" | "member" | "guest";

export type UserStatus = "active" | "invited" | "deactivated";

export interface User {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: Role;
    avatarUrl: string | null;
    status: UserStatus;
    timezone: string;
    createdAt: string;
    lastLoginAt: string | null;
}

export interface Credentials {
    email: string;
    password: string;
}

export interface PendingTwoFactor {
    email: string;
    mfaToken: string;
}

// ============================================================
// Workspace
// ============================================================

export interface Workspace {
    id: string;
    name: string;
    logoUrl: string | null;
    settings: WorkspaceSettings;
}

export interface WorkspaceSettings {
    timezone: string;
    defaultLocale: string;
    weekStartsOn: number;
    workingDays: number[];
    businessHours: { start: string; end: string };
}

// ============================================================
// Hierarchy
// ============================================================

export interface Space {
    id: string;
    workspaceId: string;
    name: string;
    description?: string;
    icon: string; // lucide-react icon name
    color: string; // hex
    isPrivate: boolean;
    /** Dept Review V1 — department head (the server always sends both fields). */
    headUserId: string | null;
    head: User | null;
    position: number;
    archivedAt: string | null;
    createdBy: string;
}

export interface Folder {
    id: string;
    spaceId: string;
    parentFolderId: string | null;
    name: string;
    position: number;
    archivedAt: string | null;
}

export interface List {
    id: string;
    spaceId: string;
    folderId: string | null;
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    position: number;
    defaultTaskTypeId?: string;
    isPrivate: boolean;
    archivedAt: string | null;
    createdBy: string;
}

// ============================================================
// Statuses, Priorities, Types, Tags
// ============================================================

export type StatusGroup = "not_started" | "active" | "done" | "closed";

export interface Status {
    id: string;
    scopeType: "space" | "folder" | "list";
    scopeId: string;
    name: string;
    color: string;
    statusGroup: StatusGroup;
    position: number;
}

/** 0 = None, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low */
export type Priority = 0 | 1 | 2 | 3 | 4;

export const PRIORITY_LABELS: Record<Priority, string> = {
    0: "None",
    1: "Urgent",
    2: "High",
    3: "Normal",
    4: "Low",
};

export interface TaskType {
    id: string;
    workspaceId: string;
    name: string;
    description?: string;
    icon: string;
    color: string;
    isMilestoneType: boolean;
    isSystem: boolean;
    /** Engineering-tier flag (wire `is_dev_type`); optional on legacy mock data. */
    isDevType?: boolean;
    /** Display order from the API; optional on legacy mock data. */
    position?: number;
}

export interface Tag {
    id: string;
    workspaceId: string;
    name: string;
    color: string;
}

// ============================================================
// Tasks
// ============================================================

export interface Task {
    id: string;
    taskNumber: number;
    customId?: string;
    name: string;
    description?: unknown; // Tiptap JSON — opaque in Phase 2
    statusId: string;
    priority: Priority;
    taskTypeId: string;
    primaryListId: string;
    parentTaskId: string | null;
    isMilestone: boolean;
    startDate: string | null;
    dueDate: string | null;
    timeEstimateSeconds: number | null;
    timeTrackedSeconds: number;
    assignees: string[]; // user ids
    watchers: string[];
    tags: string[]; // tag ids
    customFields: Record<string, unknown>;
    subtasksCount: number;
    subtasksCompleted: number;
    commentsCount: number;
    attachmentsCount: number;
    /** Checklist rollup (upgrades/022) — items across ALL the task's checklists. */
    checklistItemsTotal: number;
    checklistItemsDone: number;
    /** upgrades/023 — someone asked for this to be permanently deleted and an
     *  admin has not decided yet. The task itself is untouched meanwhile. */
    deleteRequestPending: boolean;
    /** upgrades/024 — set when the recurrence job created this task; points at
     *  the repeating template it came from. */
    recurringSourceId: string | null;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    completedAt: string | null;
    /** Dept Review V1 — current review verdict (null until the department
     *  head reviews the completed task; auto-reset when it reopens). */
    reviewStatus: "approved" | "flagged" | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
    archivedAt: string | null;
    nestingDepth: number;
    /** Optional recurrence config — when set, completing the task spawns the next instance. */
    recurrence?: TaskRecurrence | null;
    // ── Dev-only fields (only populated on dev task types) ──
    /** Sprint this task belongs to. Null = backlog. */
    sprintId?: string | null;
    /** Story-point estimate (Fibonacci-ish). */
    storyPoints?: number | null;
    /** Single reviewer — distinct from assignees. */
    reviewerId?: string | null;
    /** Suggested Git branch name. */
    branchName?: string | null;
    /** GitHub / GitLab pull-request URL. */
    prUrl?: string | null;
    /** Cached PR state (paste-time fetched). */
    prStatus?: "open" | "merged" | "closed" | "draft" | null;
    /** Bug severity (S0..S3) — only on Bug task type. */
    bugSeverity?: "S0" | "S1" | "S2" | "S3" | null;
    /** Bug reproducibility. */
    bugReproducibility?: "always" | "sometimes" | "once" | "cannot" | null;
    /** Bug environment. */
    bugEnvironment?: "production" | "staging" | "local" | null;
    /** Browser / OS string (e.g. "Chrome 120 / Windows"). */
    bugBrowser?: string | null;
    /** Which team raised this bug — for cross-team intake tracking. */
    reporterTeam?: "ops" | "cs" | "inventory" | "listing" | "marketing" | "internal" | null;
    /** Deploy timestamp (set when status moves to Deployed). */
    deployedAt?: string | null;
    /** Reason for rollback if deployment was reverted. */
    rollbackReason?: string | null;
    /**
     * SLA deadline — auto-set at task create time based on task type / severity:
     *   complaint task        → created_at + 24h
     *   bug task severity=S0  → created_at + 2h
     *   bug task severity=S1  → created_at + 24h
     *   bug task severity=S2  → created_at + 7d
     */
    slaDueAt?: string | null;
}

export type RecurrencePattern = "daily" | "weekly" | "monthly" | "custom";

export interface TaskRecurrence {
    pattern: RecurrencePattern;
    /** Every N units (e.g. every 2 weeks). 1 by default. */
    interval: number;
    /** For weekly: which weekdays (0=Sun..6=Sat). */
    daysOfWeek?: number[];
    /** For monthly: which day of the month (1..31, or -1 for last). */
    dayOfMonth?: number;
    /** For custom: cron expression. */
    cron?: string;
    /**
     * upgrades/024 — the time of day the next occurrence is created, `HH:MM`
     * on the WORKSPACE's clock. Null on recurrences set before that build; the
     * job reads null as 09:00 so they start working rather than never firing.
     */
    time?: string | null;
    /** Optional end date — recurrence stops after this. */
    endsAt?: string | null;
    /**
     * ⚠️ Client-only leftover from the mock era — there is no such column and
     * no such behaviour. Occurrences are created ON SCHEDULE by the
     * `recurrence-spawn` job, not when the previous one is completed.
     */
    spawnOnComplete: boolean;
}

// ============================================================
// Dept Review V1 — department head review + HR reports
// ============================================================

export type ReviewVerdict = "approved" | "flagged";

export type ReviewQueueBucket =
    | "needs_review"
    | "flagged"
    | "overdue"
    | "due_today";

/** One ledger row from `GET /tasks/:id/reviews` (reviewer hydrated). */
export interface TaskReview {
    id: string;
    taskId: string;
    spaceId: string;
    status: ReviewVerdict;
    note: string | null;
    reviewerId: string;
    createdAt: string;
    reviewer: User | null;
}

/** A review-queue row: a full Task + current verdict + parent breadcrumb. */
export interface ReviewQueueRow extends Task {
    review: {
        status: ReviewVerdict;
        reviewedAt: string | null;
        reviewedBy: string | null;
    } | null;
    parentTask: { id: string; name: string } | null;
}

/** `user: null` = the synthetic "Unassigned" row (always sorted last). */
export interface ReviewSummaryMember {
    user: User | null;
    open: number;
    dueToday: number;
    overdue: number;
    doneUnreviewed: number;
    flagged: number;
    lastActivity: string | null;
}

export interface ReviewSummary {
    spaceId: string;
    members: ReviewSummaryMember[];
    /** Task-level DEDUPED totals — never the sum of the member rows. */
    totals: {
        open: number;
        dueToday: number;
        overdue: number;
        doneUnreviewed: number;
        flagged: number;
    };
}

// Weekly department reports (the stored payload arrives camelized by the
// response interceptor — `payload` is deliberately NOT in the opaque set).

export interface ReportTotalsView {
    completed: number;
    completedLate: number;
    overdueNow: number;
    approved: number;
    flagged: number;
    doneUnreviewed: number;
}

export interface DeptReportFlag {
    taskId: string;
    customId: string | null;
    taskName: string;
    note: string | null;
    reviewedAt: string;
    reviewer: User | null;
    parentTask: { id: string; name: string } | null;
}

export interface DeptReportMember {
    /** null = the synthetic "Unassigned" row; `isActive` false = deactivated. */
    user: {
        id: string;
        firstName: string;
        lastName: string;
        avatarUrl: string | null;
        isActive: boolean;
    } | null;
    assignedOpen: number;
    completed: number;
    completedLate: number;
    overdueNow: number;
    approved: number;
    flagged: number;
    flags: DeptReportFlag[];
}

export interface DeptReportPayloadView {
    members: DeptReportMember[];
    totals: ReportTotalsView;
    headAccountability: {
        reviewsDone: number;
        selfReviewed: number;
        doneUnreviewedAtGeneration: number;
    };
    prevWeek: { completed: number; overdueNow: number } | null;
}

export interface DeptReportListItem {
    id: string;
    spaceId: string;
    weekStart: string;
    weekEnd: string;
    headUserId: string | null;
    head: User | null;
    headNote: string | null;
    generatedBy: string | null;
    generatedAt: string;
    acknowledgedBy: string | null;
    acknowledgedAt: string | null;
    totals: ReportTotalsView | null;
}

export interface DeptReport extends Omit<DeptReportListItem, "totals"> {
    payload: DeptReportPayloadView;
}

// ============================================================
// Notifications, reminders, activity
// ============================================================

/**
 * Mirrors the server's `notifications.type` ENUM exactly (plus a few legacy
 * client-only values the runtime fallback tolerates). The pre-existing drift
 * is fixed here: `pr_review` / `incident_alert` were missing, and the phantom
 * `reminder_due` (removed server-side long ago) is gone. The three
 * `assignment_*` values arrived with upgrades/021 (team-access P8 — the
 * cross-team assignment approval flow).
 */
export type NotificationType =
    | "assigned"
    | "mentioned"
    | "comment"
    | "status_change"
    | "due_soon"
    | "overdue"
    | "form_submitted"
    | "automation_failed"
    | "pr_review"
    | "incident_alert"
    | "task_reviewed"
    | "report_ready"
    | "assignment_request"
    | "assignment_request_decided"
    | "assignment_query";

// ─── Cross-team assignment approval (team-access P8/P9) ─────────────────────

export type AssignmentRequestStatus =
    | "pending"
    | "accepted"
    | "declined"
    | "expired"
    | "cancelled";

export type AssignmentRequestAction =
    | "created"
    | "accepted"
    | "declined"
    | "queried"
    | "answered"
    | "cancelled"
    | "expired";

/**
 * The server-hydrated task SNAPSHOT riding on a request — the receiver's
 * consent window: they may not be able to open the task itself until they
 * accept, but they always see WHAT they are being asked to take on.
 */
export interface AssignmentRequestTask {
    id: string;
    name: string;
    customId: string | null;
    listId: string;
    listName: string;
    spaceId: string;
    spaceName: string;
    dueDate: string | null;
    priority: number;
    archived: boolean;
}

export interface AssignmentRequestEvent {
    id: string;
    action: AssignmentRequestAction;
    /** null = the system (the 7-day expiry janitor). */
    actor: User | null;
    note: string | null;
    proposedDueDate: string | null;
    createdAt: string;
}

export interface AssignmentRequest {
    id: string;
    status: AssignmentRequestStatus;
    task: AssignmentRequestTask | null;
    targetUser: User | null;
    requestedBy: User | null;
    decidedBy: User | null;
    requestNote: string | null;
    queryNote: string | null;
    proposedDueDate: string | null;
    decidedAt: string | null;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    /** Oldest-first ledger of the whole negotiation. */
    events: AssignmentRequestEvent[];
}

export interface Notification {
    id: string;
    userId: string;
    type: NotificationType;
    /** Mirrors the server ENUM ("reminder" was drift — the server has
     *  "incident"; "report" arrived with Dept Review V1). */
    entityType:
        | "task"
        | "comment"
        | "form"
        | "automation"
        | "incident"
        | "report";
    entityId: string;
    actorId: string | null;
    title: string;
    body?: string;
    isRead: boolean;
    snoozedUntil: string | null;
    createdAt: string;
}

export interface Reminder {
    id: string;
    userId: string; // owner
    assignedTo: string;
    taskId: string | null;
    title: string;
    notes?: string;
    dueAt: string;
    isCompleted: boolean;
    completedAt: string | null;
}

export interface ActivityLogEntry {
    id: string;
    workspaceId: string;
    entityType:
        | "task"
        | "list"
        | "folder"
        | "space"
        | "comment"
        | "attachment"
        | "automation";
    entityId: string;
    action: string;
    actorId: string;
    context: {
        taskName?: string;
        listId?: string;
        listName?: string;
        spaceName?: string;
    };
    createdAt: string;
}

// ============================================================
// Auth state (Zustand)
// ============================================================

export interface AuthState {
    user: User | null;
    /** In-memory access token — NEVER persisted; repopulated on load via /auth/me. */
    accessToken: string | null;
    /** True until the initial /auth/me bootstrap resolves (guards show a spinner). */
    bootstrapping: boolean;
    setUser: (user: User | null) => void;
    setAccessToken: (token: string | null) => void;
    /** Full sign-out: revokes the server session (unless `revoke: false` —
     *  used when the session is already dead) and purges all user-scoped
     *  client state (query cache, chat, UI prefs). */
    logout: (opts?: { revoke?: boolean }) => void;
    /** Revalidate a (possibly cookie-only) session on app load. */
    bootstrap: () => Promise<void>;
    pendingTwoFactor: PendingTwoFactor | null;
    setPendingTwoFactor: (pending: PendingTwoFactor | null) => void;
}

// ============================================================
// API envelopes
// ============================================================

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError = {
    ok: false;
    error: { code: string; message: string; details?: unknown };
};
export type ApiResult<T> = ApiSuccess<T> | ApiError;

export type LoginResult =
    | { requires2fa: true; mfaToken: string }
    | { requires2fa: false; user: User };

/** Real backend `POST /auth/login` response (camelCase after the adapter). */
export interface LoginResponse {
    accessToken: string;
    expiresIn: number;
    user: User;
}

// ============================================================
// Home / dashboard aggregations
// ============================================================

/** F24 (ISS-057): a label and a number. The trend badge was hardcoded to
 *  0/flat/false and the sparkline plotted creation dates, not the metric. */
export interface HomeKpi {
    label: string;
    value: number;
    valueDisplay: string;
}

export interface HomeKpiSet {
    myTasks: HomeKpi;
    dueToday: HomeKpi;
    overdue: HomeKpi;
    awaitingReview: HomeKpi;
    openTeamTasks: HomeKpi;
    slaBreaches: HomeKpi;
}

// ============================================================
// Threaded comments (1 level deep)
// ============================================================

/** A reply to a top-level comment. Stored alongside Comment for simplicity. */
export interface CommentReply {
    id: string;
    parentCommentId: string;
    authorId: string;
    body: string;
    createdAt: string;
}

// ============================================================
// Customer (Bangladesh ecom — keyed by phone number)
// ============================================================

export interface Customer {
    id: string;
    phone: string;
    name: string;
    defaultAddress?: string;
    totalOrders: number;
    totalComplaints: number;
    lifetimeValue: number;
    vipFlag: boolean;
    createdAt: string;
    lastOrderAt: string | null;
}

export interface MyWorkBucket {
    today: Task[];
    overdue: Task[];
    next: Task[];
    unscheduled: Task[];
    done: Task[];
}

/**
 * One breached-SLA row from `GET /api/v1/sla/breached` (§29).
 *
 * F28 (ISS-082, decision D12.4): this endpoint shipped complete and tested on
 * the server and had ZERO callers in the client — there was no `slaApi` at all,
 * and the only SLA surface was the badge on a task drawer. The queue it was
 * built to produce is now the `/sla` page.
 */
export interface SlaBreach {
    taskId: string;
    customId: string | null;
    name: string;
    taskTypeId: string;
    /** ISO-8601. The deadline that has already passed. */
    slaDueAt: string;
    /** How far past the deadline, in minutes, as of the request. */
    minutesBreached: number;
    assignees: User[];
}
