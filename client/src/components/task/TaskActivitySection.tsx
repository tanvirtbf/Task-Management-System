import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { Activity } from "lucide-react";
import { taskActivityApi } from "../../http/api";
import { Avatar } from "../ui/Avatar";
import { tokens } from "../../theme";

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
    assignee_added: "added an assignee",
    assignee_removed: "removed an assignee",
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
};

const verb = (action: string): string =>
    VERBS[action] ?? action.replace(/_/g, " ");

/**
 * The load-bearing bit of `context`, as a short suffix. The old component read
 * only `context.taskName`, which task activity never contains — so the real
 * context (which fields changed, which checklist, what text) was discarded.
 */
const contextDetail = (
    action: string,
    context: Record<string, unknown> | null | undefined,
): string | null => {
    if (!context) return null;
    if (action === "task_updated" && Array.isArray(context.fields)) {
        const names = (context.fields as string[]).map((f) =>
            f.replace(/_/g, " "),
        );
        return names.length > 0 ? names.join(", ") : null;
    }
    if (typeof context.name === "string") return `"${context.name}"`;
    if (typeof context.text === "string") return `"${context.text}"`;
    if (action === "task_reviewed" && typeof context.status === "string") {
        return context.status;
    }
    return null;
};

export const TaskActivitySection = ({ taskId }: { taskId: string }) => {
    const { data = [], isLoading } = useQuery({
        queryKey: ["task-activity", taskId],
        queryFn: () => taskActivityApi.byTask(taskId),
    });

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
                                    {/* M12: `context` is nullable on the wire */}
                                    {contextDetail(
                                        entry.action,
                                        entry.context,
                                    ) && (
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
                                                {contextDetail(
                                                    entry.action,
                                                    entry.context,
                                                )}
                                            </span>
                                        </>
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
