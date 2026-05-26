import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
    Button,
    Input,
    Select,
    Switch,
    App as AntApp,
    Tag,
} from "antd";
import {
    ArrowLeft,
    Plus,
    Trash2,
    Zap,
    Filter,
    Workflow,
    Play,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { listsById, lists as allLists } from "../../mocks/lists";
import { customFieldsByList } from "../../mocks/custom-fields";
import { statusesByList } from "../../mocks/statuses";
import { users as allUsers } from "../../mocks/users";
import { tagsBySpace } from "../../mocks/tags";
import { spacesById } from "../../mocks/spaces";
import type {
    Automation,
    AutomationAction,
    AutomationCondition,
    ActionType,
    TriggerType,
} from "../../types/automation";
import type { Priority } from "../../types";
import { PRIORITY_LABELS } from "../../types";
import { AutomationPreview } from "../../components/automation/AutomationPreview";
import { tokens } from "../../theme";

const TRIGGER_LABELS: Record<TriggerType, string> = {
    task_created: "Task created",
    task_status_changed: "Status changes",
    task_assigned: "Task assigned",
    task_priority_changed: "Priority changes",
    task_due_soon: "Task due soon",
    task_overdue: "Task overdue",
    task_field_changed: "Custom field changes",
    task_tag_added: "Tag added",
    comment_posted: "Comment posted",
    form_submitted: "Form submitted",
    recurring_schedule: "On a schedule",
};

const ACTION_LABELS: Record<ActionType, string> = {
    set_status: "Change status",
    assign_user: "Assign user",
    set_priority: "Set priority",
    set_due_date: "Set due date",
    add_tag: "Add tag",
    remove_tag: "Remove tag",
    move_to_list: "Move to list",
    archive_task: "Archive task",
    create_subtask: "Create subtask",
    post_comment: "Post comment",
    send_notification: "Send notification",
    send_email: "Send email",
    call_webhook: "Call webhook",
    apply_template: "Apply template",
};

const AutomationBuilderPage = () => {
    const { automationId } = useParams();
    const isNew = !automationId || automationId === "new";
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();

    const { data: existing, isLoading } = useQuery({
        queryKey: ["automation", automationId],
        queryFn: () =>
            !isNew && automationId
                ? mockApi.automations.getById(automationId)
                : Promise.resolve(null),
        enabled: !isNew,
    });

    const [draft, setDraft] = useState<
        Pick<
            Automation,
            "name" | "scopeId" | "trigger" | "conditions" | "actions" | "isActive"
        >
    >({
        name: "",
        scopeId: "l-fb-orders",
        isActive: false,
        trigger: { type: "task_created", config: {} },
        conditions: { logic: "AND", rules: [] },
        actions: [],
    });

    useEffect(() => {
        if (existing) {
            setDraft({
                name: existing.name,
                scopeId: existing.scopeId,
                isActive: existing.isActive,
                trigger: existing.trigger,
                conditions: existing.conditions,
                actions: existing.actions,
            });
        }
    }, [existing]);

    const create = useMutation({
        mutationFn: () => mockApi.automations.create(draft),
        onSuccess: (a) => {
            qc.invalidateQueries({ queryKey: ["automations"] });
            message.success("Automation created");
            navigate(`/automations/${a.id}/edit`, { replace: true });
        },
    });

    const update = useMutation({
        mutationFn: () =>
            mockApi.automations.update(automationId!, draft),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["automations"] });
            qc.invalidateQueries({ queryKey: ["automation", automationId] });
            message.success("Automation saved");
        },
    });

    const test = useMutation({
        mutationFn: () => mockApi.automations.test(automationId!),
        onSuccess: (run) => {
            message.success(
                `Test passed — ${run.actionsLog.length} actions in ${run.durationMs}ms`,
            );
        },
    });

    if (!isNew && isLoading) {
        return <div style={{ padding: 24 }}>Loading...</div>;
    }

    const list = listsById.get(draft.scopeId);
    const space = list ? spacesById.get(list.spaceId) : undefined;

    const addCondition = () => {
        setDraft({
            ...draft,
            conditions: {
                ...draft.conditions,
                rules: [
                    ...draft.conditions.rules,
                    {
                        id: `cond-${Date.now()}`,
                        field: "priority",
                        operator: "eq",
                        value: 3,
                    },
                ],
            },
        });
    };

    const updateCondition = (id: string, patch: Partial<AutomationCondition>) => {
        setDraft({
            ...draft,
            conditions: {
                ...draft.conditions,
                rules: draft.conditions.rules.map((r) =>
                    r.id === id ? { ...r, ...patch } : r,
                ),
            },
        });
    };

    const removeCondition = (id: string) => {
        setDraft({
            ...draft,
            conditions: {
                ...draft.conditions,
                rules: draft.conditions.rules.filter((r) => r.id !== id),
            },
        });
    };

    const addAction = (type: ActionType) => {
        setDraft({
            ...draft,
            actions: [
                ...draft.actions,
                {
                    id: `act-${Date.now()}`,
                    type,
                    config: defaultActionConfig(type),
                },
            ],
        });
    };

    const updateAction = (id: string, patch: Partial<AutomationAction>) => {
        setDraft({
            ...draft,
            actions: draft.actions.map((a) =>
                a.id === id ? { ...a, ...patch } : a,
            ),
        });
    };

    const updateActionConfig = (
        id: string,
        config: Record<string, unknown>,
    ) => {
        setDraft({
            ...draft,
            actions: draft.actions.map((a) =>
                a.id === id ? { ...a, config } : a,
            ),
        });
    };

    const removeAction = (id: string) => {
        setDraft({
            ...draft,
            actions: draft.actions.filter((a) => a.id !== id),
        });
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                minHeight: "calc(100vh - 48px)",
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[5]}px`,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    background: tokens.colors.bgSurface,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                }}
            >
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowLeft size={14} strokeWidth={1.75} />}
                    onClick={() => navigate("/automations")}
                >
                    Automations
                </Button>
                <div
                    style={{
                        width: 1,
                        height: 20,
                        background: tokens.colors.border,
                    }}
                />
                <Input
                    value={draft.name}
                    onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                    }
                    placeholder="Untitled automation"
                    variant="borderless"
                    style={{
                        fontWeight: 700,
                        fontSize: tokens.typography.fontSize.lg,
                        padding: 0,
                        width: 360,
                    }}
                />
                <Tag>
                    In: <strong>{space?.name} / {list?.name}</strong>
                </Tag>
                <div style={{ flex: 1 }} />
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                    }}
                >
                    <span
                        style={{
                            fontSize: 12,
                            color: tokens.colors.textSecondary,
                        }}
                    >
                        {draft.isActive ? "Active" : "Paused"}
                    </span>
                    <Switch
                        checked={draft.isActive}
                        onChange={(v) => setDraft({ ...draft, isActive: v })}
                        size="small"
                    />
                </div>
                {!isNew && (
                    <Button
                        size="small"
                        icon={<Play size={13} strokeWidth={1.75} />}
                        onClick={() => test.mutate()}
                        loading={test.isPending}
                    >
                        Test
                    </Button>
                )}
                <Button
                    type="primary"
                    size="small"
                    onClick={() => (isNew ? create.mutate() : update.mutate())}
                    loading={create.isPending || update.isPending}
                    disabled={!draft.name.trim()}
                >
                    {isNew ? "Create" : "Save"}
                </Button>
            </div>

            {/* Body */}
            <div
                style={{
                    flex: 1,
                    overflow: "auto",
                    background: tokens.colors.bgPage,
                    padding: tokens.spacing[6],
                }}
            >
                <div
                    style={{
                        maxWidth: 720,
                        margin: "0 auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[4],
                    }}
                >
                    {/* List scope */}
                    <SectionCard>
                        <div style={sectionLabelStyle}>List scope</div>
                        <Select
                            value={draft.scopeId}
                            onChange={(v) => setDraft({ ...draft, scopeId: v })}
                            style={{ width: "100%" }}
                            options={allLists.map((l) => {
                                const sp = spacesById.get(l.spaceId);
                                return {
                                    value: l.id,
                                    label: `${sp?.name} / ${l.name}`,
                                };
                            })}
                        />
                    </SectionCard>

                    {/* Step 1: Trigger */}
                    <SectionCard
                        icon={<Zap size={16} strokeWidth={1.75} />}
                        accent={tokens.colors.warning}
                        step="1"
                        title="When..."
                        subtitle="Pick the event that should start this automation."
                    >
                        <Select
                            value={draft.trigger.type}
                            onChange={(v) =>
                                setDraft({
                                    ...draft,
                                    trigger: {
                                        type: v as TriggerType,
                                        config: {},
                                    },
                                })
                            }
                            style={{ width: "100%" }}
                            options={(
                                Object.keys(TRIGGER_LABELS) as TriggerType[]
                            ).map((t) => ({
                                value: t,
                                label: TRIGGER_LABELS[t],
                            }))}
                        />

                        <TriggerConfig
                            triggerType={draft.trigger.type}
                            config={draft.trigger.config}
                            listId={draft.scopeId}
                            onChange={(config) =>
                                setDraft({
                                    ...draft,
                                    trigger: { ...draft.trigger, config },
                                })
                            }
                        />
                    </SectionCard>

                    {/* Step 2: Conditions (optional) */}
                    <SectionCard
                        icon={<Filter size={16} strokeWidth={1.75} />}
                        accent={tokens.colors.info}
                        step="2"
                        title="If..."
                        subtitle="Optional rules that must be true for actions to run."
                    >
                        {draft.conditions.rules.length === 0 ? (
                            <Button
                                size="small"
                                icon={<Plus size={12} strokeWidth={2} />}
                                onClick={addCondition}
                            >
                                Add condition
                            </Button>
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                }}
                            >
                                {draft.conditions.rules.length > 1 && (
                                    <div
                                        style={{
                                            display: "inline-flex",
                                            background: tokens.colors.bgMuted,
                                            borderRadius: tokens.radius.md,
                                            padding: 2,
                                            width: "fit-content",
                                        }}
                                    >
                                        {(["AND", "OR"] as const).map((l) => (
                                            <button
                                                key={l}
                                                onClick={() =>
                                                    setDraft({
                                                        ...draft,
                                                        conditions: {
                                                            ...draft.conditions,
                                                            logic: l,
                                                        },
                                                    })
                                                }
                                                style={logicBtnStyle(
                                                    draft.conditions.logic === l,
                                                )}
                                            >
                                                {l}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {draft.conditions.rules.map((rule) => (
                                    <ConditionRow
                                        key={rule.id}
                                        rule={rule}
                                        listId={draft.scopeId}
                                        onUpdate={(p) =>
                                            updateCondition(rule.id, p)
                                        }
                                        onRemove={() => removeCondition(rule.id)}
                                    />
                                ))}
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<Plus size={12} strokeWidth={2} />}
                                    onClick={addCondition}
                                >
                                    Add condition
                                </Button>
                            </div>
                        )}
                    </SectionCard>

                    {/* Step 3: Actions */}
                    <SectionCard
                        icon={<Workflow size={16} strokeWidth={1.75} />}
                        accent={tokens.colors.success}
                        step="3"
                        title="Then..."
                        subtitle="Actions execute in order from top to bottom."
                    >
                        {draft.actions.length === 0 ? (
                            <Select
                                placeholder="Add an action..."
                                style={{ width: "100%" }}
                                value={undefined}
                                onChange={(v) => addAction(v as ActionType)}
                                options={(
                                    Object.keys(ACTION_LABELS) as ActionType[]
                                ).map((a) => ({
                                    value: a,
                                    label: ACTION_LABELS[a],
                                }))}
                            />
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                }}
                            >
                                {draft.actions.map((action, idx) => (
                                    <ActionRow
                                        key={action.id}
                                        idx={idx}
                                        action={action}
                                        listId={draft.scopeId}
                                        onUpdateType={(type) =>
                                            updateAction(action.id, {
                                                type,
                                                config: defaultActionConfig(type),
                                            })
                                        }
                                        onUpdateConfig={(config) =>
                                            updateActionConfig(action.id, config)
                                        }
                                        onRemove={() => removeAction(action.id)}
                                    />
                                ))}
                                <Select
                                    placeholder="+ Add another action..."
                                    style={{ width: "100%" }}
                                    value={undefined}
                                    onChange={(v) => addAction(v as ActionType)}
                                    options={(
                                        Object.keys(ACTION_LABELS) as ActionType[]
                                    ).map((a) => ({
                                        value: a,
                                        label: ACTION_LABELS[a],
                                    }))}
                                />
                            </div>
                        )}
                    </SectionCard>

                    {/* Preview */}
                    <AutomationPreview automation={draft} />
                </div>
            </div>
        </div>
    );
};

// ─── Trigger config ──────────────────────────────────────
const TriggerConfig = ({
    triggerType,
    config,
    listId,
    onChange,
}: {
    triggerType: TriggerType;
    config: Record<string, unknown>;
    listId: string;
    onChange: (c: Record<string, unknown>) => void;
}) => {
    if (triggerType === "task_status_changed") {
        const statuses = statusesByList(listId);
        return (
            <div style={{ marginTop: 8 }}>
                <label style={smallLabelStyle}>Status changes to (optional)</label>
                <Select
                    value={config.toStatusId as string}
                    onChange={(v) => onChange({ ...config, toStatusId: v })}
                    placeholder="Any status"
                    allowClear
                    style={{ width: "100%" }}
                    options={statuses.map((s) => ({
                        value: s.id,
                        label: s.name,
                    }))}
                />
            </div>
        );
    }
    if (triggerType === "task_due_soon") {
        return (
            <div style={{ marginTop: 8 }}>
                <label style={smallLabelStyle}>Days before due date</label>
                <Input
                    type="number"
                    value={(config.daysBefore as number) ?? 1}
                    onChange={(e) =>
                        onChange({
                            ...config,
                            daysBefore: Number(e.target.value) || 1,
                        })
                    }
                />
            </div>
        );
    }
    if (triggerType === "recurring_schedule") {
        return (
            <div style={{ marginTop: 8 }}>
                <label style={smallLabelStyle}>Cron expression</label>
                <Input
                    value={(config.cron as string) ?? "0 9 * * MON"}
                    onChange={(e) =>
                        onChange({ ...config, cron: e.target.value })
                    }
                    placeholder="0 9 * * MON"
                    style={{ fontFamily: tokens.typography.fontFamilyMono }}
                />
            </div>
        );
    }
    return null;
};

// ─── Condition row ──────────────────────────────────────
const ConditionRow = ({
    rule,
    listId,
    onUpdate,
    onRemove,
}: {
    rule: AutomationCondition;
    listId: string;
    onUpdate: (patch: Partial<AutomationCondition>) => void;
    onRemove: () => void;
}) => {
    const statuses = statusesByList(listId);
    const customFields = customFieldsByList(listId);

    const fieldOptions = [
        { value: "status", label: "Status" },
        { value: "priority", label: "Priority" },
        { value: "assignee", label: "Assignee" },
        ...customFields.map((cf) => ({
            value: `cf:${cf.id}`,
            label: cf.name,
        })),
    ];

    return (
        <div
            style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: 6,
                background: tokens.colors.bgMuted,
                borderRadius: tokens.radius.md,
            }}
        >
            <Select
                value={rule.field}
                onChange={(v) => onUpdate({ field: v })}
                options={fieldOptions}
                style={{ width: 180 }}
                size="small"
            />
            <Select
                value={rule.operator}
                onChange={(v) => onUpdate({ operator: v })}
                style={{ width: 100 }}
                size="small"
                options={[
                    { value: "eq", label: "is" },
                    { value: "neq", label: "is not" },
                    { value: "gt", label: ">" },
                    { value: "gte", label: "≥" },
                    { value: "lt", label: "<" },
                    { value: "lte", label: "≤" },
                    { value: "is_empty", label: "is empty" },
                    { value: "is_not_empty", label: "is not empty" },
                ]}
            />
            {rule.operator !== "is_empty" &&
                rule.operator !== "is_not_empty" && (
                    <>
                        {rule.field === "status" ? (
                            <Select
                                value={rule.value as string}
                                onChange={(v) => onUpdate({ value: v })}
                                style={{ flex: 1 }}
                                size="small"
                                options={statuses.map((s) => ({
                                    value: s.id,
                                    label: s.name,
                                }))}
                            />
                        ) : rule.field === "priority" ? (
                            <Select
                                value={rule.value as number}
                                onChange={(v) => onUpdate({ value: v })}
                                style={{ flex: 1 }}
                                size="small"
                                options={[1, 2, 3, 4, 0].map((p) => ({
                                    value: p,
                                    label: PRIORITY_LABELS[p as Priority],
                                }))}
                            />
                        ) : (
                            <Input
                                value={String(rule.value ?? "")}
                                onChange={(e) =>
                                    onUpdate({ value: e.target.value })
                                }
                                size="small"
                                placeholder="Value"
                                style={{ flex: 1 }}
                            />
                        )}
                    </>
                )}
            <Button
                size="small"
                type="text"
                icon={<Trash2 size={12} strokeWidth={1.75} />}
                onClick={onRemove}
            />
        </div>
    );
};

// ─── Action row ──────────────────────────────────────────
const ActionRow = ({
    idx,
    action,
    listId,
    onUpdateType,
    onUpdateConfig,
    onRemove,
}: {
    idx: number;
    action: AutomationAction;
    listId: string;
    onUpdateType: (t: ActionType) => void;
    onUpdateConfig: (c: Record<string, unknown>) => void;
    onRemove: () => void;
}) => {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: 10,
                background: tokens.colors.bgMuted,
                border: `1px solid ${tokens.colors.borderSubtle}`,
                borderRadius: tokens.radius.md,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                <span
                    style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: tokens.colors.success,
                        color: "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {idx + 1}
                </span>
                <Select
                    value={action.type}
                    onChange={(v) => onUpdateType(v as ActionType)}
                    style={{ flex: 1 }}
                    size="small"
                    options={(
                        Object.keys(ACTION_LABELS) as ActionType[]
                    ).map((a) => ({
                        value: a,
                        label: ACTION_LABELS[a],
                    }))}
                />
                <Button
                    size="small"
                    type="text"
                    icon={<Trash2 size={12} strokeWidth={1.75} />}
                    onClick={onRemove}
                />
            </div>
            <ActionConfig
                action={action}
                listId={listId}
                onChange={onUpdateConfig}
            />
        </div>
    );
};

const ActionConfig = ({
    action,
    listId,
    onChange,
}: {
    action: AutomationAction;
    listId: string;
    onChange: (c: Record<string, unknown>) => void;
}) => {
    const list = listsById.get(listId);
    const config = action.config;

    if (action.type === "set_status") {
        const statuses = statusesByList(listId);
        return (
            <Select
                value={config.statusId as string}
                onChange={(v) => onChange({ ...config, statusId: v })}
                placeholder="Pick a status"
                size="small"
                style={{ width: "100%" }}
                options={statuses.map((s) => ({
                    value: s.id,
                    label: s.name,
                }))}
            />
        );
    }
    if (action.type === "set_priority") {
        return (
            <Select
                value={config.priority as Priority}
                onChange={(v) => onChange({ ...config, priority: v })}
                size="small"
                placeholder="Pick a priority"
                style={{ width: "100%" }}
                options={[1, 2, 3, 4, 0].map((p) => ({
                    value: p,
                    label: PRIORITY_LABELS[p as Priority],
                }))}
            />
        );
    }
    if (action.type === "assign_user") {
        return (
            <Select
                mode="multiple"
                value={(config.userIds as string[]) ?? []}
                onChange={(v) => onChange({ ...config, userIds: v, mode: "add" })}
                placeholder="Pick people"
                size="small"
                style={{ width: "100%" }}
                showSearch
                optionFilterProp="label"
                options={allUsers.map((u) => ({
                    value: u.id,
                    label: `${u.firstName} ${u.lastName}`,
                }))}
            />
        );
    }
    if (action.type === "add_tag" || action.type === "remove_tag") {
        const tags = list ? tagsBySpace(list.spaceId) : [];
        return (
            <Select
                value={config.tagId as string}
                onChange={(v) => onChange({ ...config, tagId: v })}
                size="small"
                placeholder="Pick a tag"
                style={{ width: "100%" }}
                options={tags.map((t) => ({ value: t.id, label: t.name }))}
            />
        );
    }
    if (action.type === "post_comment") {
        return (
            <Input.TextArea
                value={(config.bodyTemplate as string) ?? ""}
                onChange={(e) =>
                    onChange({ ...config, bodyTemplate: e.target.value })
                }
                placeholder="Comment text — supports {{task.name}}, {{task.assignees}}, etc."
                autoSize={{ minRows: 2, maxRows: 4 }}
            />
        );
    }
    if (action.type === "send_notification") {
        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                }}
            >
                <Select
                    mode="multiple"
                    value={(config.userIds as string[]) ?? []}
                    onChange={(v) => onChange({ ...config, userIds: v })}
                    placeholder="To: pick people"
                    size="small"
                    style={{ width: "100%" }}
                    options={allUsers.map((u) => ({
                        value: u.id,
                        label: `${u.firstName} ${u.lastName}`,
                    }))}
                />
                <Input
                    value={(config.messageTemplate as string) ?? ""}
                    onChange={(e) =>
                        onChange({
                            ...config,
                            messageTemplate: e.target.value,
                        })
                    }
                    placeholder="Message template..."
                    size="small"
                />
            </div>
        );
    }
    if (action.type === "send_email") {
        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                }}
            >
                <Select
                    mode="multiple"
                    value={(config.to as string[]) ?? []}
                    onChange={(v) => onChange({ ...config, to: v })}
                    placeholder="To"
                    size="small"
                    style={{ width: "100%" }}
                    options={allUsers.map((u) => ({
                        value: u.id,
                        label: u.email,
                    }))}
                />
                <Input
                    value={(config.subjectTemplate as string) ?? ""}
                    onChange={(e) =>
                        onChange({
                            ...config,
                            subjectTemplate: e.target.value,
                        })
                    }
                    placeholder="Subject..."
                    size="small"
                />
                <Input.TextArea
                    value={(config.bodyTemplate as string) ?? ""}
                    onChange={(e) =>
                        onChange({
                            ...config,
                            bodyTemplate: e.target.value,
                        })
                    }
                    placeholder="Email body..."
                    autoSize={{ minRows: 2, maxRows: 5 }}
                />
            </div>
        );
    }
    if (action.type === "create_subtask") {
        return (
            <Input
                value={(config.nameTemplate as string) ?? ""}
                onChange={(e) =>
                    onChange({ ...config, nameTemplate: e.target.value })
                }
                size="small"
                placeholder="Subtask name (supports template vars)..."
            />
        );
    }
    if (action.type === "call_webhook") {
        return (
            <Input
                value={(config.url as string) ?? ""}
                onChange={(e) => onChange({ ...config, url: e.target.value })}
                size="small"
                placeholder="https://your-webhook-url.com"
                style={{ fontFamily: tokens.typography.fontFamilyMono }}
            />
        );
    }
    return null;
};

// ─── Section card wrapper ────────────────────────────────
const SectionCard = ({
    icon,
    accent,
    step,
    title,
    subtitle,
    children,
}: {
    icon?: React.ReactNode;
    accent?: string;
    step?: string;
    title?: string;
    subtitle?: string;
    children: React.ReactNode;
}) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[4],
            position: "relative",
        }}
    >
        {(title || icon) && (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: tokens.spacing[3],
                }}
            >
                {step && (
                    <span
                        style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: accent ?? tokens.colors.primary,
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 700,
                            fontFamily: tokens.typography.fontFamilyMono,
                            flexShrink: 0,
                        }}
                    >
                        {step}
                    </span>
                )}
                {icon && (
                    <span style={{ color: accent ?? tokens.colors.primary }}>
                        {icon}
                    </span>
                )}
                <div style={{ flex: 1 }}>
                    {title && (
                        <h3
                            style={{
                                margin: 0,
                                fontSize: tokens.typography.fontSize.base,
                                fontWeight: 600,
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            {title}
                        </h3>
                    )}
                    {subtitle && (
                        <p
                            style={{
                                margin: 0,
                                marginTop: 2,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            {subtitle}
                        </p>
                    )}
                </div>
            </div>
        )}
        {children}
    </div>
);

const sectionLabelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: tokens.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
};

const smallLabelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 500,
    color: tokens.colors.textSecondary,
    marginBottom: 4,
};

const logicBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 12px",
    background: active ? tokens.colors.bgSurface : "transparent",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    fontFamily: tokens.typography.fontFamilyMono,
    color: active ? tokens.colors.textPrimary : tokens.colors.textMuted,
    boxShadow: active ? tokens.shadows.sm : "none",
});

const defaultActionConfig = (type: ActionType): Record<string, unknown> => {
    switch (type) {
        case "assign_user":
            return { userIds: [], mode: "add" };
        case "set_priority":
            return { priority: 3 };
        case "set_status":
            return {};
        case "add_tag":
        case "remove_tag":
            return {};
        case "post_comment":
            return { bodyTemplate: "" };
        case "send_notification":
            return { userIds: [], messageTemplate: "" };
        case "send_email":
            return { to: [], subjectTemplate: "", bodyTemplate: "" };
        case "create_subtask":
            return { nameTemplate: "" };
        case "call_webhook":
            return { url: "" };
        default:
            return {};
    }
};

export default AutomationBuilderPage;
