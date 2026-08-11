import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { Activity } from "lucide-react";
import { taskActivityApi } from "../../http/api";
import {
    useStatusMap,
    useTaskTypeMap,
    useUserMap,
} from "../../hooks/useReferenceData";
import { Avatar } from "../ui/Avatar";
import { tokens } from "../../theme";
import { PRIORITY_LABELS, type Priority, type User } from "../../types";

const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / (1000 * 60));
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

// F21 (ISS-061): this switch was written against the MOCK API's vocabulary and
// never updated when the real backend landed — 11 of 13 real action codes fell
// through to raw snake_case, and 7 of its 9 cases were codes the server never
// emits (`assigned`, `branch_created`, `pr_opened`…). This is now the REAL
// vocabulary, verified against every `task_activity` writer in server/src.
const VERBS: Record<string, string> = {
    task_created: "created this task",
    task_updated: "updated",
    status_changed: "moved status",
    assignee_added: "assigned",
    assignee_removed: "unassigned",
    tag_added: "added a tag",
    tag_removed: "removed a tag",
    comment_posted: "commented",
    comment_referenced: "referenced this task in a comment",
    checklist_created: "added a checklist",
    checklist_deleted: "deleted a checklist",
    checklist_item_added: "added a checklist item",
    checklist_item_deleted: "deleted a checklist item",
    checklist_item_toggled: "ticked a checklist item",
    checklist_item_updated: "edited a checklist item",
    dependency_added: "linked a dependency",
    dependency_removed: "removed a dependency",
    sprint_added: "added this task to a sprint",
    sprint_removed: "removed this task from a sprint",
    task_removed: "removed this task from a sprint",
    sprint_rolled_over: "rolled this task into the next sprint",
    task_archived: "archived this task",
    task_unarchived: "restored this task",
    task_reviewed: "reviewed this task",
    sla_overridden: "overrode the SLA",
    created_from_template: "created this task from a template",
    custom_field_value_set: "set a custom field",
    custom_field_value_cleared: "cleared a custom field",
    // Team-access P3 — the operations that used to be invisible.
    comment_updated: "edited a comment",
    comment_deleted: "deleted a comment",
    attachment_added: "attached a file",
    attachment_removed: "removed a file",
    checklist_renamed: "renamed a checklist",
    postmortem_submitted: "filled in the postmortem",
};

const verb = (action: string): string =>
    VERBS[action] ?? action.replace(/_/g, " ");

/**
 * Team-access P2 — the audit log rendered for HUMANS. The server has recorded
 * `{field: {from, to}}` diffs since F21, and this component threw them away,
 * printing only field names ("updated — priority, due date"). Now every
 * `task_updated` row shows readable before→after values, ids resolved through
 * the reference maps the drawer already caches (statuses per list, task types,
 * users) — zero extra requests.
 *
 * ⚠️ The response camelizer renames CONTEXT KEYS too: the server's
 * `changes.task_type_id` arrives as `changes.taskTypeId`, `user_id` as
 * `userId`. Everything here speaks camelCase on purpose.
 */

/** Human field names; fallback = decamelized key. */
const FIELD_LABELS: Record<string, string> = {
    name: "name",
    customId: "task ID",
    priority: "priority",
    taskTypeId: "type",
    reviewerId: "reviewer",
    dueDate: "due date",
    startDate: "start date",
    isMilestone: "milestone",
    storyPoints: "story points",
    timeEstimateSeconds: "time estimate",
    recurrencePattern: "recurrence",
    recurrenceDays: "recurrence days",
    recurrenceEndsAt: "recurrence end",
    branchName: "branch",
    prUrl: "PR",
    prStatus: "PR status",
    bugSeverity: "severity",
    bugReproducibility: "reproducibility",
    bugEnvironment: "environment",
    bugBrowser: "browser",
    reporterTeam: "reporter team",
    deployedAt: "deployed at",
    rollbackReason: "rollback reason",
};

/** Fields whose values are unreadable/huge — show "edited" with no values. */
const VALUELESS_FIELDS = new Set(["description", "sprintId"]);

const fieldLabel = (key: string): string =>
    FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").toLowerCase().trim();

const fullName = (u: User | undefined): string | null =>
    u ? `${u.firstName} ${u.lastName}`.trim() : null;

const shortSeconds = (s: number): string => {
    if (s % 3600 === 0) return `${s / 3600}h`;
    if (s % 60 === 0) return `${s / 60}m`;
    return `${s}s`;
};

interface RefMaps {
    users: Map<string, User>;
    types: Map<string, { name: string }>;
    statuses: Map<string, { name: string }>;
}

/** One diff value → short human text. Deleted references degrade honestly. */
const formatValue = (field: string, v: unknown, maps: RefMaps): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (field === "priority") {
        return PRIORITY_LABELS[v as Priority] ?? String(v);
    }
    if (field === "taskTypeId") {
        return maps.types.get(String(v))?.name ?? "(deleted type)";
    }
    if (field === "reviewerId") {
        return fullName(maps.users.get(String(v))) ?? "(removed user)";
    }
    if (field === "timeEstimateSeconds" && typeof v === "number") {
        return shortSeconds(v);
    }
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (Array.isArray(v)) return v.map(String).join(", ") || "—";
    const s = String(v);
    return s.length > 48 ? `${s.slice(0, 48)}…` : s;
};

interface DiffRow {
    label: string;
    detail: string;
}

/** `task_updated` context → one readable row per changed field. */
const diffRows = (
    context: Record<string, unknown>,
    maps: RefMaps,
): DiffRow[] => {
    const changes = context.changes;
    if (typeof changes !== "object" || changes === null) {
        // Pre-F21 rows carry only `fields` — degrade to the old name list.
        const fields = Array.isArray(context.fields)
            ? (context.fields as string[])
            : [];
        return fields.map((f) => ({
            label: f.replace(/_/g, " "),
            detail: "changed",
        }));
    }
    const rows: DiffRow[] = [];
    for (const [key, raw] of Object.entries(
        changes as Record<string, unknown>,
    )) {
        const label = fieldLabel(key);
        if (VALUELESS_FIELDS.has(key)) {
            rows.push({ label, detail: "edited" });
            continue;
        }
        const pair = raw as { from?: unknown; to?: unknown } | null;
        const from = formatValue(key, pair?.from, maps);
        const to = formatValue(key, pair?.to, maps);
        rows.push({ label, detail: `${from} → ${to}` });
    }
    return rows;
};

/** Single-line suffix for the non-update actions (name hydration included). */
const contextDetail = (
    action: string,
    context: Record<string, unknown> | null | undefined,
    maps: RefMaps,
): string | null => {
    if (!context) return null;
    if (action === "status_changed") {
        // P3: names are denormalised into the row (`from_name`/`to_name` →
        // camelized) — rename-proof and correct across list moves. Older rows
        // predate that; fall back to the drawer's status map.
        const from =
            (typeof context.fromName === "string" && context.fromName) ||
            maps.statuses.get(String(context.from))?.name ||
            "(old status)";
        const to =
            (typeof context.toName === "string" && context.toName) ||
            maps.statuses.get(String(context.to))?.name ||
            "(new status)";
        return `${from} → ${to}`;
    }
    if (
        (action === "assignee_added" || action === "assignee_removed") &&
        typeof context.userId === "string"
    ) {
        return fullName(maps.users.get(context.userId)) ?? "a member";
    }
    if (action === "comment_deleted" && typeof context.authorId === "string") {
        const author = fullName(maps.users.get(context.authorId));
        return author ? `by ${author}` : null;
    }
    if (action === "checklist_renamed") {
        return `"${String(context.from ?? "")}" → "${String(context.to ?? "")}"`;
    }
    if (action === "checklist_item_updated") {
        if (
            typeof context.textFrom === "string" &&
            typeof context.textTo === "string"
        ) {
            return `"${context.textFrom}" → "${context.textTo}"`;
        }
        if (Array.isArray(context.fields)) {
            return (context.fields as string[]).join(", ");
        }
    }
    if (action === "custom_field_value_set") {
        const field =
            typeof context.fieldName === "string" ? context.fieldName : null;
        const value =
            context.value === null || context.value === undefined
                ? null
                : typeof context.value === "object"
                  ? JSON.stringify(context.value)
                  : String(context.value);
        if (field) return value !== null ? `${field}: ${value}` : field;
    }
    if (
        action === "custom_field_value_cleared" &&
        typeof context.fieldName === "string"
    ) {
        return context.fieldName;
    }
    if (
        (action === "task_archived" || action === "task_unarchived") &&
        context.viaParent
    ) {
        return "with its parent task";
    }
    if (typeof context.name === "string") return `"${context.name}"`;
    if (typeof context.text === "string") return `"${context.text}"`;
    if (action === "task_reviewed" && typeof context.status === "string") {
        return context.status;
    }
    return null;
};

export const TaskActivitySection = ({
    taskId,
    listId,
}: {
    taskId: string;
    /** Resolves status names in `status_changed` rows (drawer cache — free). */
    listId?: string;
}) => {
    const { data = [], isLoading } = useQuery({
        queryKey: ["task-activity", taskId],
        queryFn: () => taskActivityApi.byTask(taskId),
    });
    const users = useUserMap();
    const types = useTaskTypeMap();
    const statuses = useStatusMap(listId);
    const maps: RefMaps = { users, types, statuses };

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: tokens.spacing[3],
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                }}
            >
                <Activity size={11} strokeWidth={1.75} />
                Activity
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {data.length}
                </span>
            </div>

            {isLoading ? (
                <Skeleton active paragraph={{ rows: 3 }} />
            ) : data.length === 0 ? (
                <div
                    style={{
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                    }}
                >
                    No activity yet.
                </div>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    {data.map((entry) => {
                        const actor = entry.actor;
                        const isUpdate = entry.action === "task_updated";
                        const detail = isUpdate
                            ? null
                            : contextDetail(entry.action, entry.context, maps);
                        const rows =
                            isUpdate && entry.context
                                ? diffRows(entry.context, maps)
                                : [];
                        // P3: bulk assignee/tag/archive rows carry the flag too.
                        const isBulk = entry.context?.bulk === true;
                        return (
                            <div
                                key={entry.id}
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "flex-start",
                                }}
                            >
                                <Avatar
                                    name={
                                        actor
                                            ? `${actor.firstName} ${actor.lastName}`
                                            : "?"
                                    }
                                    src={actor?.avatarUrl}
                                    size={22}
                                />
                                <div
                                    style={{
                                        flex: 1,
                                        fontSize: tokens.typography.fontSize.sm,
                                        color: tokens.colors.textSecondary,
                                        lineHeight: 1.4,
                                    }}
                                >
                                    <span
                                        style={{
                                            fontWeight: 600,
                                            color: tokens.colors.textPrimary,
                                        }}
                                    >
                                        {actor?.firstName ?? "Someone"}
                                    </span>{" "}
                                    {verb(entry.action)}
                                    {isBulk ? " (bulk edit)" : ""}
                                    {detail && (
                                        <>
                                            {" — "}
                                            <span
                                                style={{
                                                    fontFamily:
                                                        tokens.typography
                                                            .fontFamilyMono,
                                                    fontSize: 12,
                                                    color: tokens.colors
                                                        .textPrimary,
                                                }}
                                            >
                                                {detail}
                                            </span>
                                        </>
                                    )}
                                    {rows.length > 0 && (
                                        <div
                                            style={{
                                                marginTop: 3,
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 2,
                                            }}
                                        >
                                            {rows.map((r, i) => (
                                                <div
                                                    key={`${entry.id}-${i}`}
                                                    style={{
                                                        fontFamily:
                                                            tokens.typography
                                                                .fontFamilyMono,
                                                        fontSize: 12,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            color: tokens
                                                                .colors
                                                                .textMuted,
                                                        }}
                                                    >
                                                        {r.label}:{" "}
                                                    </span>
                                                    <span
                                                        style={{
                                                            color: tokens
                                                                .colors
                                                                .textPrimary,
                                                        }}
                                                    >
                                                        {r.detail}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            marginTop: 1,
                                        }}
                                    >
                                        {timeAgo(entry.createdAt)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
