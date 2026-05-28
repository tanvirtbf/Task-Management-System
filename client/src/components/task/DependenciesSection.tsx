import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton, Select, Button, Tooltip } from "antd";
import { Link2, ArrowRight, ArrowLeft, X, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { mockApi } from "../../lib/mock-api";
import { statusesById } from "../../mocks/statuses";
import { tasks as allTasks } from "../../mocks/tasks";
import { tokens } from "../../theme";

interface Props {
    taskId: string;
    listId: string;
}

export const DependenciesSection = ({ taskId, listId }: Props) => {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const [showPicker, setShowPicker] = useState<"blocks" | "blocked_by" | null>(
        null,
    );
    const [pickedTaskId, setPickedTaskId] = useState<string | undefined>();

    const { data: deps = [], isLoading } = useQuery({
        queryKey: ["deps", taskId],
        queryFn: () => mockApi.taskDependencies.byTask(taskId),
    });

    const create = useMutation({
        mutationFn: (input: { relatedTaskId: string; type: "blocks" }) =>
            mockApi.taskDependencies.create({ taskId, ...input }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["deps", taskId] });
            setShowPicker(null);
            setPickedTaskId(undefined);
        },
    });

    const remove = useMutation({
        mutationFn: (id: string) => mockApi.taskDependencies.delete(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["deps", taskId] }),
    });

    const blocks = deps.filter((d) => d.type === "blocks");
    const blockedBy = deps.filter((d) => d.type === ("blocked_by" as never));

    const candidates = allTasks.filter(
        (t) =>
            t.id !== taskId &&
            t.primaryListId &&
            !t.archivedAt &&
            !deps.some((d) => d.otherTaskId === t.id),
    );

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
                <Link2 size={11} strokeWidth={1.75} />
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
                    type="text"
                    size="small"
                    icon={<Plus size={12} strokeWidth={2} />}
                    onClick={() => setShowPicker("blocks")}
                    style={{ marginLeft: "auto" }}
                >
                    Link
                </Button>
            </div>

            {isLoading ? (
                <Skeleton active paragraph={{ rows: 2 }} />
            ) : (
                <>
                    {blocks.length > 0 && (
                        <DepGroup
                            label="Blocks"
                            icon={<ArrowRight size={11} strokeWidth={1.75} />}
                            items={blocks}
                            onOpen={(otherId) => {
                                const url = new URL(window.location.href);
                                url.searchParams.set("task", otherId);
                                navigate(url.pathname + url.search);
                            }}
                            onRemove={(id) => remove.mutate(id)}
                        />
                    )}
                    {blockedBy.length > 0 && (
                        <DepGroup
                            label="Blocked by"
                            icon={<ArrowLeft size={11} strokeWidth={1.75} />}
                            items={blockedBy}
                            onOpen={(otherId) => {
                                const url = new URL(window.location.href);
                                url.searchParams.set("task", otherId);
                                navigate(url.pathname + url.search);
                            }}
                            onRemove={(id) => remove.mutate(id)}
                            warn
                        />
                    )}
                </>
            )}

            {showPicker && (
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        marginTop: tokens.spacing[2],
                    }}
                >
                    <Select
                        size="small"
                        showSearch
                        autoFocus
                        value={pickedTaskId}
                        onChange={setPickedTaskId}
                        placeholder="Pick a task to block…"
                        style={{ flex: 1 }}
                        optionFilterProp="label"
                        options={candidates.slice(0, 200).map((t) => ({
                            value: t.id,
                            label: `${t.customId ?? `T-${t.taskNumber}`} — ${t.name}`,
                        }))}
                    />
                    <Button
                        size="small"
                        type="primary"
                        disabled={!pickedTaskId}
                        onClick={() =>
                            pickedTaskId &&
                            create.mutate({
                                relatedTaskId: pickedTaskId,
                                type: "blocks",
                            })
                        }
                    >
                        Add
                    </Button>
                    <Button
                        size="small"
                        type="text"
                        onClick={() => {
                            setShowPicker(null);
                            setPickedTaskId(undefined);
                        }}
                    >
                        Cancel
                    </Button>
                </div>
            )}
        </div>
    );
};

const DepGroup = ({
    label,
    icon,
    items,
    onOpen,
    onRemove,
    warn,
}: {
    label: string;
    icon: React.ReactNode;
    items: Array<{ id: string; otherTaskId: string }>;
    onOpen: (otherTaskId: string) => void;
    onRemove: (id: string) => void;
    warn?: boolean;
}) => (
    <div style={{ marginBottom: 6 }}>
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: warn ? tokens.colors.danger : tokens.colors.textMuted,
                fontWeight: 600,
                marginBottom: 4,
            }}
        >
            {icon}
            {label}
        </div>
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
            }}
        >
            {items.map((d) => {
                const other = allTasks.find((t) => t.id === d.otherTaskId);
                if (!other) return null;
                const status = statusesById.get(other.statusId);
                return (
                    <div
                        key={d.id}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 8px",
                            borderRadius: tokens.radius.sm,
                            background: warn
                                ? "rgba(220, 38, 38, 0.05)"
                                : tokens.colors.bgMuted,
                        }}
                    >
                        <span
                            style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: status?.color ?? "#94A3B8",
                            }}
                        />
                        <button
                            onClick={() => onOpen(d.otherTaskId)}
                            style={{
                                flex: 1,
                                background: "none",
                                border: 0,
                                padding: 0,
                                cursor: "pointer",
                                textAlign: "left",
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textPrimary,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    color: tokens.colors.textMuted,
                                    fontSize: 11,
                                    marginRight: 6,
                                }}
                            >
                                {other.customId ?? `T-${other.taskNumber}`}
                            </span>
                            {other.name}
                        </button>
                        <Tooltip title="Unlink">
                            <button
                                onClick={() => onRemove(d.id)}
                                style={{
                                    background: "none",
                                    border: 0,
                                    padding: 2,
                                    cursor: "pointer",
                                    color: tokens.colors.textMuted,
                                    display: "flex",
                                }}
                                aria-label="Unlink"
                            >
                                <X size={11} strokeWidth={1.75} />
                            </button>
                        </Tooltip>
                    </div>
                );
            })}
        </div>
    </div>
);
