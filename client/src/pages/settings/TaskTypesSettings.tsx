import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Input,
    Modal,
    Popconfirm,
    Tag,
    App as AntApp,
} from "antd";
import {
    Plus,
    Pencil,
    Trash2,
} from "lucide-react";
import { taskTypesApi } from "../../http/api";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";
import type { TaskType } from "../../types";

const COLOR_PALETTE = [
    "#4F46E5",
    "#10B981",
    "#F59E0B",
    "#E11D48",
    "#8B5CF6",
    "#06B6D4",
    "#EC4899",
    "#64748B",
];

const ICON_PALETTE = [
    "Hexagon",
    "Diamond",
    "Star",
    "Flag",
    "Bug",
    "Sparkles",
    "Target",
    "ShoppingCart",
    "Package",
    "AlertCircle",
    "FileText",
    "Image",
    "Megaphone",
    "Headphones",
];

const TaskTypesSettings = () => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [editing, setEditing] = useState<TaskType | "new" | null>(null);

    const { data: taskTypes = [] } = useQuery({
        queryKey: ["task-types"],
        queryFn: () => taskTypesApi.list(),
    });

    const remove = useMutation({
        mutationFn: (id: string) => taskTypesApi.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["task-types"] });
            message.success("Task type deleted");
        },
        onError: (err) =>
            message.error(
                err instanceof Error ? err.message : "Failed to delete",
            ),
    });

    return (
        <div>
            <SettingsHeader
                title="Task types"
                description="Categorize tasks (Order, Complaint, Bug, etc.). Each has its own icon and color."
                actions={
                    <Button
                        type="primary"
                        icon={<Plus size={14} strokeWidth={2} />}
                        onClick={() => setEditing("new")}
                    >
                        New task type
                    </Button>
                }
            />

            <SettingsSection>
                {taskTypes.length === 0 ? (
                    <div
                        style={{
                            padding: 24,
                            textAlign: "center",
                            color: tokens.colors.textMuted,
                        }}
                    >
                        No task types yet.
                    </div>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        {taskTypes.map((tt) => (
                            <div
                                key={tt.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    padding: "10px 0",
                                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                                }}
                            >
                                <div
                                    style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: tokens.radius.sm,
                                        background: `${tt.color}1A`,
                                        color: tt.color,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                    }}
                                >
                                    <DynamicIcon
                                        name={tt.icon}
                                        size={16}
                                        strokeWidth={1.75}
                                    />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize:
                                                tokens.typography.fontSize.sm,
                                            fontWeight: 600,
                                        }}
                                    >
                                        {tt.name}
                                        {tt.isSystem && (
                                            <Tag
                                                style={{
                                                    margin: 0,
                                                    marginLeft: 6,
                                                    fontSize: 10,
                                                }}
                                            >
                                                System
                                            </Tag>
                                        )}
                                        {tt.isMilestoneType && (
                                            <Tag
                                                color="purple"
                                                style={{
                                                    margin: 0,
                                                    marginLeft: 6,
                                                    fontSize: 10,
                                                }}
                                            >
                                                Milestone
                                            </Tag>
                                        )}
                                    </div>
                                    {tt.description && (
                                        <div
                                            style={{
                                                fontSize: 12,
                                                color: tokens.colors.textMuted,
                                            }}
                                        >
                                            {tt.description}
                                        </div>
                                    )}
                                </div>
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<Pencil size={13} strokeWidth={1.75} />}
                                    onClick={() => setEditing(tt)}
                                >
                                    Edit
                                </Button>
                                <Popconfirm
                                    title={`Delete “${tt.name}”?`}
                                    okType="danger"
                                    onConfirm={() => remove.mutate(tt.id)}
                                    disabled={tt.isSystem}
                                >
                                    <Button
                                        size="small"
                                        type="text"
                                        danger
                                        disabled={tt.isSystem}
                                        icon={
                                            <Trash2
                                                size={13}
                                                strokeWidth={1.75}
                                            />
                                        }
                                    />
                                </Popconfirm>
                            </div>
                        ))}
                    </div>
                )}
            </SettingsSection>

            {editing && (
                <TaskTypeEditor
                    taskType={editing === "new" ? null : editing}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
};

const TaskTypeEditor = ({
    taskType,
    onClose,
}: {
    taskType: TaskType | null;
    onClose: () => void;
}) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [name, setName] = useState(taskType?.name ?? "");
    const [description, setDescription] = useState(
        taskType?.description ?? "",
    );
    const [icon, setIcon] = useState(taskType?.icon ?? "Hexagon");
    const [color, setColor] = useState(taskType?.color ?? COLOR_PALETTE[0]);
    const [isMilestoneType, setIsMilestoneType] = useState(
        taskType?.isMilestoneType ?? false,
    );

    const save = useMutation({
        mutationFn: () =>
            taskType
                ? taskTypesApi.update(taskType.id, {
                      name,
                      description,
                      icon,
                      color,
                      isMilestoneType,
                  })
                : taskTypesApi.create({
                      name,
                      description,
                      icon,
                      color,
                      isMilestoneType,
                  }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["task-types"] });
            message.success(taskType ? "Task type updated" : "Task type created");
            onClose();
        },
    });

    return (
        <Modal
            open
            title={taskType ? "Edit task type" : "New task type"}
            onCancel={onClose}
            onOk={() => save.mutate()}
            okText={taskType ? "Save" : "Create"}
            okButtonProps={{
                disabled: !name.trim(),
                loading: save.isPending,
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    paddingTop: 8,
                }}
            >
                <Field label="Name">
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Bug"
                        autoFocus
                    />
                </Field>
                <Field label="Description (optional)">
                    <Input.TextArea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 3 }}
                        placeholder="Short summary of when to use this type"
                    />
                </Field>
                <Field label="Icon">
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns:
                                "repeat(auto-fill, minmax(36px, 1fr))",
                            gap: 4,
                        }}
                    >
                        {ICON_PALETTE.map((ic) => (
                            <button
                                key={ic}
                                onClick={() => setIcon(ic)}
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: tokens.radius.sm,
                                    background:
                                        icon === ic
                                            ? `${color}1A`
                                            : tokens.colors.bgMuted,
                                    color:
                                        icon === ic
                                            ? color
                                            : tokens.colors.textSecondary,
                                    border:
                                        icon === ic
                                            ? `1px solid ${color}`
                                            : "1px solid transparent",
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                <DynamicIcon name={ic} size={16} strokeWidth={1.75} />
                            </button>
                        ))}
                    </div>
                </Field>
                <Field label="Color">
                    <div style={{ display: "flex", gap: 6 }}>
                        {COLOR_PALETTE.map((c) => (
                            <button
                                key={c}
                                onClick={() => setColor(c)}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "50%",
                                    background: c,
                                    border:
                                        color === c
                                            ? `2px solid ${tokens.colors.textPrimary}`
                                            : "2px solid transparent",
                                    cursor: "pointer",
                                }}
                            />
                        ))}
                    </div>
                </Field>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: 8,
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.sm,
                    }}
                >
                    <input
                        type="checkbox"
                        checked={isMilestoneType}
                        onChange={(e) =>
                            setIsMilestoneType(e.target.checked)
                        }
                    />
                    <span style={{ fontSize: 13 }}>
                        Treat tasks of this type as milestones in Gantt and
                        Timeline views.
                    </span>
                </div>
                {/* Preview */}
                <div
                    style={{
                        marginTop: 8,
                        padding: 12,
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    <div
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: tokens.radius.sm,
                            background: `${color}1A`,
                            color,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <DynamicIcon name={icon} size={18} strokeWidth={1.75} />
                    </div>
                    <div>
                        <div style={{ fontWeight: 600 }}>
                            {name || "Task type name"}
                        </div>
                        <div
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                                fontFamily: tokens.typography.fontFamilyMono,
                            }}
                        >
                            Preview
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

const Field = ({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) => (
    <div>
        <label
            style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: tokens.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 4,
            }}
        >
            {label}
        </label>
        {children}
    </div>
);

export default TaskTypesSettings;
