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
    fiscalYearStartMonth?: number;
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
}

export interface Tag {
    id: string;
    spaceId: string;
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
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    completedAt: string | null;
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
    /** Optional end date — recurrence stops after this. */
    endsAt?: string | null;
    /** When true, the next instance is created automatically when the current completes. */
    spawnOnComplete: boolean;
}

// ============================================================
// Notifications, reminders, activity
// ============================================================

export type NotificationType =
    | "assigned"
    | "mentioned"
    | "comment"
    | "status_change"
    | "due_soon"
    | "overdue"
    | "form_submitted"
    | "automation_failed"
    | "reminder_due";

export interface Notification {
    id: string;
    userId: string;
    type: NotificationType;
    entityType: "task" | "comment" | "form" | "reminder" | "automation";
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
    setUser: (user: User | null) => void;
    logout: () => void;
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

// ============================================================
// Home / dashboard aggregations
// ============================================================

export interface HomeKpi {
    label: string;
    value: number;
    valueDisplay: string;
    trend: number; // percent change
    trendDirection: "up" | "down" | "flat";
    isPositive: boolean; // is "up" good?
    sparkline: number[]; // last 7 days
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
