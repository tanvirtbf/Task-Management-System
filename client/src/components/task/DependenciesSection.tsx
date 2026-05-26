import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    App as AntApp,
    Popconfirm,
    Select,
    Modal,
} from "antd";
import {
    GitBranch,
    Plus,
    X,
    AlertOctagon,
    Hourglass,
    Link as LinkIcon,
    Lock,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { mockApi } from "../../lib/mock-api";
import { tokens } from "../../theme";
import type { DependencyType, TaskDependency } from "../../types/extras";
import type { Task } from "../../types";

const TYPE_META: Record<
    DependencyType,
    {
        label: string;
        description: string;
        icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
        color: string;
    }
> = {
    blocks: {
        label: "Blocking",
        description: "This task blocks the related one",
        icon: AlertOctagon,
        color: "#E11D48",
    },
    blocked_by: {
        label: "Blocked by",
        description: "This task is blocked by another",
        icon: Lock,
        color: "#F59E0B",
    },
    waiting_on: {
        label: "Waiting on",
        description: "Soft dependency — waiting for the other to finish",
        icon: Hourglass,
        color: "#8B5CF6",
    },
    linked: {
        label: "Linked",
        description: "Informational link, no scheduling impact",
        icon: LinkIcon,
        color: "#06B6D4",
    },
};

interface Props {
    taskId: string;
    listId: string;
}

export const DependenciesSection = ({ taskId, listId }: Props) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [addOpen, setAddOpen] = useState(false);

    const { data: deps = [] } = useQuery({
        queryKey: ["task-deps", taskId],
        queryFn: () => mockApi.taskDependencies.byTask(taskId),
    });
    const { data: allTasks = [] } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => mockApi.tasks.listByList(listId),
    });
    const tasksById = useMemo(
        () => new Map(allTasks.map((t) => [t.id, t])),
        [allTasks],
    );

    const grouped = useMemo(() => {
        const map: Record<DependencyType, typeof deps> = {
            blocks: [],
            blocked_by: [],
            waiting_on: [],
            linked: [],
        };
        deps.forEach((d) => map[d.type].push(d));
        return map;
    }, [deps]);

    const remove = useMutation({
        mutationFn: (id: string) => mockApi.taskDependencies.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["task-deps", taskId] });
            message.success("Dependency removed");
        },
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
                <GitBranch size={11} strokeWidth={1.75} />
                Dependencies
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {deps.length}
                </span>
                <Button
                    size="small"
                    type="text"
                    icon={<Plus size={12} strokeWidth={2} />}
                    onClick={() => setAddOpen(true)}
                    style={{ marginLeft: "auto" }}
                >
                    Add
                </Button>
            </div>

            {deps.length === 0 ? (
                <div
                    style={{
                        padding: tokens.spacing[3],
                        textAlign: "center",
                        color: tokens.colors.textMuted,
                        fontSize: tokens.typography.fontSize.sm,
                        border: `1px dashed ${tokens.colors.border}`,
                        borderRadius: tokens.radius.md,
                    }}
                >
                    No dependencies yet.
                </div>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                    }}
                >
                    {(Object.keys(grouped) as DependencyType[])
                        .filter((t) => grouped[t].length > 0)
                        .map((type) => (
                            <DepGroup
                                key={type}
                                type={type}
                                deps={grouped[type]}
                                tasksById={tasksById}
                                onRemove={(id) => remove.mutate(id)}
                            />
                        ))}
                </div>
            )}

            {addOpen && (
                <AddDependencyModal
                    taskId={taskId}
                    allTasks={allTasks}
                    onClose={() => setAddOpen(false)}
                />
            )}
        </div>
    );
};

const DepGroup = ({
    type,
    deps,
    tasksById,
    onRemove,
}: {
    type: DependencyType;
    deps: Array<TaskDependency & { otherTaskId: string }>;
    tasksById: Map<string, Task>;
    onRemove: (id: string) => void;
}) => {
    const meta = TYPE_META[type];
    const Icon = meta.icon;
    const navigate = useNavigate();
    return (
        <div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    color: meta.color,
                    marginBottom: 4,
                }}
            >
                <Icon size={11} strokeWidth={1.75} />
                <span>{meta.label}</span>
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                }}
            >
                {deps.map((d) => {
                    const other = tasksById.get(d.otherTaskId);
                    return (
                        <div
                            key={d.id}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 10px",
                                background: tokens.colors.bgMuted,
                                borderRadius: tokens.radius.md,
                                borderLeft: `3px solid ${meta.color}`,
                            }}
                        >
                            <button
                                onClick={() =>
                                    navigate(
                                        `/t/${other?.customId ?? d.otherTaskId}`,
                                    )
                                }
                                disabled={!other}
                                style={{
                                    flex: 1,
                                    background: "transparent",
                                    border: 0,
                                    cursor: other ? "pointer" : "default",
                                    padding: 0,
                                    textAlign: "left",
                                    color: tokens.colors.textPrimary,
                                    fontSize: tokens.typography.fontSize.sm,
                                    fontWeight: 500,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {other ? (
                                    <>
                                        <span
                                            style={{
                                                fontFamily:
                                                    tokens.typography
                                                        .fontFamilyMono,
                                                fontSize: 11,
                                                color: tokens.colors.textMuted,
                                                marginRight: 6,
                                            }}
                                        >
                                            {other.customId ??
                                                `T-${other.taskNumber}`}
                                        </span>
                                        {other.name}
                                    </>
                                ) : (
                                    <span
                                        style={{
                                            color: tokens.colors.textMuted,
                                            fontStyle: "italic",
                                        }}
                                    >
                                        Task not visible in this list
                                    </span>
                                )}
                            </button>
                            <Popconfirm
                                title="Remove this dependency?"
                                onConfirm={() => onRemove(d.id)}
                            >
                                <button
                                    aria-label="Remove dependency"
                                    title="Remove"
                                    style={{
                                        background: "transparent",
                                        border: 0,
                                        cursor: "pointer",
                                        padding: 2,
                                        color: tokens.colors.textMuted,
                                        display: "inline-flex",
                                    }}
                                >
                                    <X size={12} strokeWidth={1.75} />
                                </button>
                            </Popconfirm>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const AddDependencyModal = ({
    taskId,
    allTasks,
    onClose,
}: {
    taskId: string;
    allTasks: Task[];
    onClose: () => void;
}) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [type, setType] = useState<DependencyType>("blocked_by");
    const [relatedTaskId, setRelatedTaskId] = useState<string | undefined>();

    const create = useMutation({
        mutationFn: () => {
            if (!relatedTaskId)
                return Promise.reject(new Error("Pick a task"));
            return mockApi.taskDependencies.create({
                taskId,
                relatedTaskId,
                type,
            });
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["task-deps", taskId] });
            message.success("Dependency added");
            onClose();
        },
        onError: (err) =>
            message.error(
                err instanceof Error
                    ? err.message
                    : "Failed to add dependency",
            ),
    });

    const options = allTasks
        .filter((t) => t.id !== taskId)
        .map((t) => ({
            value: t.id,
            label: `${t.customId ?? `T-${t.taskNumber}`} — ${t.name}`,
        }));

    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => create.mutate()}
            okText="Add"
            okButtonProps={{
                disabled: !relatedTaskId,
                loading: create.isPending,
            }}
            title="Add dependency"
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    paddingTop: 8,
                }}
            >
                <div>
                    <Label>Type</Label>
                    <Select
                        value={type}
                        onChange={setType}
                        style={{ width: "100%" }}
                        options={(
                            Object.keys(TYPE_META) as DependencyType[]
                        ).map((t) => ({
                            value: t,
                            label: TYPE_META[t].label,
                        }))}
                    />
                    <p
                        style={{
                            margin: 0,
                            marginTop: 4,
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            lineHeight: 1.4,
                        }}
                    >
                        {TYPE_META[type].description}
                    </p>
                </div>
                <div>
                    <Label>Related task</Label>
                    <Select
                        value={relatedTaskId}
                        onChange={setRelatedTaskId}
                        placeholder="Search tasks in this list…"
                        showSearch
                        optionFilterProp="label"
                        style={{ width: "100%" }}
                        options={options}
                    />
                </div>
            </div>
        </Modal>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
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
        {children}
    </label>
);
