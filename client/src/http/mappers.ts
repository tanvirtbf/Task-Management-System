import type {
    Notification,
    NotificationType,
    Task,
    TaskRecurrence,
    User,
    Workspace,
} from "../types";
import type { Attachment } from "../types/extras";

/**
 * Per-resource structural mappers — the few shapes the generic snake↔camel
 * adapter (client.ts) cannot bridge on its own (see FRONTEND_INTEGRATION_PLAN.md
 * §1 "Structural mappers"). Everything else relies on the generic transform.
 *
 * Inputs here are ALREADY snake→camel converted by the response interceptor, so
 * these operate on camelCase "wire" shapes.
 */

// Backend weekday set (db/schema/_shared weekDays), index 0=Sun..6=Sat — matches
// the FE `workingDays: number[]` / `daysOfWeek: number[]` convention.
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const dayNameToIndex = (n: string): number => {
    const i = WEEKDAYS.indexOf(n.toLowerCase().slice(0, 3) as (typeof WEEKDAYS)[number]);
    return i >= 0 ? i : 0;
};
export const dayIndexToName = (i: number): string => WEEKDAYS[i] ?? "sun";

// ─── Workspace: FLAT wire → nested FE `settings` ──────────────────────────────
export interface WireWorkspace {
    id: string;
    name: string;
    logoUrl: string | null;
    timezone: string;
    defaultLocale: string;
    weekStartsOn: number;
    workingDays: string[];
    businessHoursStart: string;
    businessHoursEnd: string;
    fiscalYearStartMonth: number;
}

export const mapWorkspace = (w: WireWorkspace): Workspace => ({
    id: w.id,
    name: w.name,
    logoUrl: w.logoUrl,
    settings: {
        timezone: w.timezone,
        defaultLocale: w.defaultLocale,
        weekStartsOn: w.weekStartsOn,
        workingDays: (w.workingDays ?? []).map(dayNameToIndex),
        businessHours: {
            start: w.businessHoursStart,
            end: w.businessHoursEnd,
        },
        fiscalYearStartMonth: w.fiscalYearStartMonth,
    },
});

/** FE Workspace settings patch → flat wire patch for PATCH /workspace. */
export const workspaceToWire = (
    patch: Partial<Workspace>,
): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (patch.name !== undefined) out.name = patch.name;
    if (patch.logoUrl !== undefined) out.logoUrl = patch.logoUrl;
    const s = patch.settings;
    if (s) {
        if (s.timezone !== undefined) out.timezone = s.timezone;
        if (s.defaultLocale !== undefined) out.defaultLocale = s.defaultLocale;
        if (s.weekStartsOn !== undefined) out.weekStartsOn = s.weekStartsOn;
        if (s.workingDays !== undefined)
            out.workingDays = s.workingDays.map(dayIndexToName);
        if (s.businessHours !== undefined) {
            out.businessHoursStart = s.businessHours.start;
            out.businessHoursEnd = s.businessHours.end;
        }
        if (s.fiscalYearStartMonth !== undefined)
            out.fiscalYearStartMonth = s.fiscalYearStartMonth;
    }
    return out;
};

// ─── Task: flat recurrence → nested; customFieldValues → customFields ─────────
// The wire task is the FE Task (camelCase) MINUS `customFields`/`recurrence`,
// PLUS the flat recurrence_* fields, `customFieldValues`, `workspaceId` and
// `internalId` (none of which exist on the FE `Task`).
export type WireTask = Omit<Task, "customFields" | "recurrence"> & {
    customFieldValues?: Record<string, unknown> | null;
    recurrencePattern?: string | null;
    recurrenceDays?: string[] | null;
    recurrenceEndsAt?: string | null;
    workspaceId?: string;
    internalId?: number;
};

export const mapTask = (w: WireTask): Task => {
    const {
        customFieldValues,
        recurrencePattern,
        recurrenceDays,
        recurrenceEndsAt,
        // dropped — not part of the FE Task type
        workspaceId: _workspaceId,
        internalId: _internalId,
        ...base
    } = w;

    const recurrence: TaskRecurrence | null =
        recurrencePattern && recurrencePattern !== "none"
            ? {
                  pattern: recurrencePattern as TaskRecurrence["pattern"],
                  interval: 1,
                  daysOfWeek: Array.isArray(recurrenceDays)
                      ? recurrenceDays.map(dayNameToIndex)
                      : undefined,
                  endsAt: recurrenceEndsAt ?? null,
                  spawnOnComplete: true,
              }
            : null;

    return {
        ...base,
        customFields: customFieldValues ?? {},
        recurrence,
    };
};

/**
 * FE Task create/update patch → wire request body. The generic decamelize
 * handles the simple key casing; this only fixes the two structural renames the
 * backend needs (`customFields`→`custom_field_values`, nested `recurrence`→flat
 * `recurrence_*`). Returns a camelCase object — the request interceptor
 * decamelizes it on the way out.
 */
export const taskToWire = (
    patch: Partial<Task>,
): Record<string, unknown> => {
    const { customFields, recurrence, ...rest } = patch;
    const out: Record<string, unknown> = { ...rest };
    if (customFields !== undefined) out.customFieldValues = customFields;
    if (recurrence !== undefined) {
        out.recurrencePattern = recurrence?.pattern ?? "none";
        out.recurrenceDays =
            recurrence?.daysOfWeek?.map(dayIndexToName) ?? null;
        out.recurrenceEndsAt = recurrence?.endsAt ?? null;
    }
    return out;
};

// ─── Task activity (§13): wire row with `actor` hydrated to the full User ─────
export interface TaskActivityEntry {
    id: string;
    action: string;
    actor: User | null;
    context: { taskName?: string; listName?: string } & Record<
        string,
        unknown
    >;
    createdAt: string;
}

// ─── Task dependencies (§12): {blocks,blocked_by} (other-end hydrated) → flat ─
interface WireDependencyEdge {
    id: string;
    task: WireTask;
    type: "blocks" | "blocked_by";
    createdAt: string;
}
export interface WireDependenciesView {
    blocks: WireDependencyEdge[];
    blockedBy: WireDependencyEdge[];
}
/** UI-friendly flat edge: one row per dependency, the OTHER end hydrated. */
export interface FlatDependency {
    id: string;
    type: "blocks" | "blocked_by";
    otherTaskId: string;
    otherTask: Task;
}
export const flattenDependencies = (
    view: WireDependenciesView,
): FlatDependency[] => [
    ...(view.blocks ?? []).map((e) => ({
        id: e.id,
        type: "blocks" as const,
        otherTaskId: e.task.id,
        otherTask: mapTask(e.task),
    })),
    ...(view.blockedBy ?? []).map((e) => ({
        id: e.id,
        type: "blocked_by" as const,
        otherTaskId: e.task.id,
        otherTask: mapTask(e.task),
    })),
];

// ─── Attachments (§16): wire `mime_type`/`size_bytes` → FE `type`/`size` ──────
export interface WireAttachment {
    id: string;
    taskId: string;
    name: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    thumbnailUrl: string | null;
    uploadedBy: string;
    uploadedAt: string;
}
export const mapAttachment = (a: WireAttachment): Attachment => ({
    id: a.id,
    taskId: a.taskId,
    name: a.name,
    type: a.mimeType,
    size: a.sizeBytes,
    url: a.url,
    thumbnailUrl: a.thumbnailUrl ?? undefined,
    uploadedBy: a.uploadedBy,
    uploadedAt: a.uploadedAt,
});

// ─── Notifications (§19): wire OMITS user_id (JWT inbox); body null→undefined ─
export interface WireNotification {
    id: string;
    type: string;
    entityType: string;
    entityId: string;
    actorId: string | null;
    title: string;
    body: string | null;
    isRead: boolean;
    snoozedUntil: string | null;
    createdAt: string;
}
export const mapNotification = (w: WireNotification): Notification => ({
    id: w.id,
    userId: "", // wire omits user_id (always the caller); the FE never reads it
    type: w.type as NotificationType,
    entityType: w.entityType as Notification["entityType"],
    entityId: w.entityId,
    actorId: w.actorId,
    title: w.title,
    body: w.body ?? undefined,
    isRead: w.isRead,
    snoozedUntil: w.snoozedUntil,
    createdAt: w.createdAt,
});

// ─── On-call (§21): wire hydrates the full `engineer` (User), not a bare id ───
export interface WireOnCallShift {
    id: string;
    weekStart: string;
    weekEnd: string;
    engineer: User;
}
/** FE shape: the flat `engineerId` the UI keys on, plus the hydrated engineer. */
export interface OnCallShiftView {
    id: string;
    weekStart: string;
    weekEnd: string;
    engineerId: string;
    engineer: User;
}
export const mapOnCallShift = (w: WireOnCallShift): OnCallShiftView => ({
    id: w.id,
    weekStart: w.weekStart,
    weekEnd: w.weekEnd,
    engineerId: w.engineer.id,
    engineer: w.engineer,
});
