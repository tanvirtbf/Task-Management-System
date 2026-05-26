import type {
    ActionType,
    Automation,
    TriggerType,
} from "../../types/automation";
import { PRIORITY_LABELS, type Priority } from "../../types";
import { statusesById, tagsById, usersById, listsById } from "../../mocks";
import { tokens } from "../../theme";

const TRIGGER_PHRASE: Record<TriggerType, string> = {
    task_created: "a task is created",
    task_status_changed: "a task's status changes",
    task_assigned: "a task is assigned to someone",
    task_priority_changed: "a task's priority changes",
    task_due_soon: "a task is due soon",
    task_overdue: "a task becomes overdue",
    task_field_changed: "a custom field changes",
    task_tag_added: "a tag is added to a task",
    comment_posted: "a comment is posted",
    form_submitted: "a form is submitted",
    recurring_schedule: "on a recurring schedule",
};

const ACTION_PHRASE: Record<ActionType, (config: Record<string, unknown>) => React.ReactNode> = {
    set_status: (c) => {
        const status = statusesById.get(c.statusId as string);
        return (
            <>
                set status to{" "}
                <Chip color={status?.color ?? "#94A3B8"}>
                    {status?.name ?? "?"}
                </Chip>
            </>
        );
    },
    assign_user: (c) => {
        const ids = (c.userIds as string[]) ?? [];
        const users = ids.map((id) => usersById.get(id)).filter(Boolean);
        const mode = (c.mode as string) ?? "replace";
        return (
            <>
                {mode === "add" ? "add" : "assign to"}{" "}
                {users.map((u, i) => (
                    <span key={u!.id}>
                        <Chip>@{u!.firstName}</Chip>
                        {i < users.length - 1 ? " and " : ""}
                    </span>
                ))}
            </>
        );
    },
    set_priority: (c) => (
        <>
            set priority to{" "}
            <Chip>{PRIORITY_LABELS[c.priority as Priority] ?? "?"}</Chip>
        </>
    ),
    set_due_date: (c) => (
        <>
            set due date to <Chip>{String(c.dueDate ?? "now+1d")}</Chip>
        </>
    ),
    add_tag: (c) => {
        const tag = tagsById.get(c.tagId as string);
        return (
            <>
                add tag{" "}
                <Chip color={tag?.color ?? "#94A3B8"}>
                    {tag?.name ?? "?"}
                </Chip>
            </>
        );
    },
    remove_tag: (c) => {
        const tag = tagsById.get(c.tagId as string);
        return (
            <>
                remove tag <Chip>{tag?.name ?? "?"}</Chip>
            </>
        );
    },
    move_to_list: (c) => {
        const l = listsById.get(c.listId as string);
        return (
            <>
                move to list <Chip>{l?.name ?? "?"}</Chip>
            </>
        );
    },
    archive_task: () => <>archive the task</>,
    create_subtask: (c) => (
        <>
            create subtask{" "}
            <Chip>“{String(c.nameTemplate ?? "subtask")}”</Chip>
        </>
    ),
    post_comment: (c) => (
        <>
            post comment{" "}
            <Chip>“{String(c.bodyTemplate ?? "comment").slice(0, 40)}”</Chip>
        </>
    ),
    send_notification: (c) => {
        const ids = (c.userIds as string[]) ?? [];
        const recipients =
            ids.length > 0
                ? ids
                      .map((id) => `@${usersById.get(id)?.firstName ?? "?"}`)
                      .join(", ")
                : "watchers";
        return (
            <>
                send notification to <Chip>{recipients}</Chip>
            </>
        );
    },
    send_email: (c) => {
        const ids = (c.to as string[]) ?? [];
        const recipients =
            ids.length > 0
                ? ids
                      .map((id) => `@${usersById.get(id)?.firstName ?? id}`)
                      .join(", ")
                : "team";
        return (
            <>
                send email to <Chip>{recipients}</Chip>
            </>
        );
    },
    call_webhook: (c) => (
        <>
            call webhook{" "}
            <Chip>
                <code style={{ fontSize: 11 }}>
                    {String(c.url ?? "—").slice(0, 30)}
                </code>
            </Chip>
        </>
    ),
    apply_template: (c) => (
        <>
            apply template <Chip>{String(c.templateId ?? "?")}</Chip>
        </>
    ),
};

interface Props {
    automation: Pick<Automation, "trigger" | "conditions" | "actions">;
}

export const AutomationPreview = ({ automation }: Props) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[4],
            fontSize: tokens.typography.fontSize.base,
            lineHeight: 1.7,
            color: tokens.colors.textPrimary,
        }}
    >
        <div
            style={{
                fontSize: 11,
                fontWeight: 600,
                color: tokens.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
            }}
        >
            Plain English
        </div>
        <div>
            <strong>When</strong>{" "}
            {TRIGGER_PHRASE[automation.trigger.type] ?? "(unknown trigger)"}
            {automation.conditions.rules.length > 0 && (
                <>
                    {", "}
                    <strong>if</strong>{" "}
                    {automation.conditions.rules.map((rule, idx) => (
                        <span key={rule.id}>
                            {idx > 0 && (
                                <span
                                    style={{
                                        color: tokens.colors.textMuted,
                                    }}
                                >
                                    {" "}
                                    {automation.conditions.logic === "AND"
                                        ? "and"
                                        : "or"}{" "}
                                </span>
                            )}
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    fontSize: 13,
                                    background: tokens.colors.bgMuted,
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                }}
                            >
                                {rule.field} {opPhrase(rule.operator)}{" "}
                                {formatValue(rule.value)}
                            </span>
                        </span>
                    ))}
                </>
            )}
            {automation.actions.length > 0 ? (
                <>
                    {", "}
                    <strong>then</strong>{" "}
                    {automation.actions.map((a, i) => {
                        const renderer = ACTION_PHRASE[a.type];
                        return (
                            <span key={a.id}>
                                {i > 0 && (
                                    <span
                                        style={{
                                            color: tokens.colors.textMuted,
                                        }}
                                    >
                                        {" "}
                                        and{" "}
                                    </span>
                                )}
                                {renderer
                                    ? renderer(a.config)
                                    : `do ${a.type.replace(/_/g, " ")}`}
                            </span>
                        );
                    })}
                    .
                </>
            ) : (
                <span
                    style={{
                        color: tokens.colors.textMuted,
                        fontStyle: "italic",
                    }}
                >
                    {" "}
                    — no actions yet.
                </span>
            )}
        </div>
    </div>
);

const Chip = ({
    children,
    color,
}: {
    children: React.ReactNode;
    color?: string;
}) => (
    <span
        style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 6px",
            margin: "0 1px",
            background: color ? `${color}1A` : tokens.colors.primarySubtle,
            color: color ?? tokens.colors.primary,
            borderRadius: 4,
            fontWeight: 600,
            fontSize: 13,
        }}
    >
        {children}
    </span>
);

const opPhrase = (op: string): string => {
    switch (op) {
        case "eq":
            return "is";
        case "neq":
            return "is not";
        case "gt":
            return ">";
        case "gte":
            return "≥";
        case "lt":
            return "<";
        case "lte":
            return "≤";
        case "contains":
            return "contains";
        case "is_empty":
            return "is empty";
        case "is_not_empty":
            return "is not empty";
        default:
            return op;
    }
};

const formatValue = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "string" && v.startsWith("cf:"))
        return v.replace("cf:", "");
    return String(v);
};
