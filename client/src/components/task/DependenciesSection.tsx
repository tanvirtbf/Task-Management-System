import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton, Select, Button, Tooltip } from "antd";
import { Link2, ArrowRight, ArrowLeft, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { dependenciesApi, searchApi } from "../../http/api";
import type { FlatDependency } from "../../http/mappers";
import { tokens } from "../../theme";

/** F25 (ISS-055): `listId` is gone — the picker searches the WORKSPACE now,
 *  not one list. */
interface Props {
    taskId: string;
}

export const DependenciesSection = ({ taskId }: Props) => {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const [showPicker, setShowPicker] = useState<"blocks" | "blocked_by" | null>(
        null,
    );
    const [pickedTaskId, setPickedTaskId] = useState<string | undefined>();

    const { data: deps = [], isLoading } = useQuery({
        queryKey: ["deps", taskId],
        queryFn: () => dependenciesApi.byTask(taskId),
    });

    // F25 (ISS-055): candidates are the WHOLE WORKSPACE, not just this list.
    // The API has always allowed a dependency between any two tasks, and the
    // most valuable ones in this product cross departments — "Marketing's
    // launch banner blocks Engineering's release" could not be created in the
    // UI at all. Search is the right source: it is workspace-wide, it is
    // visibility-filtered server-side (RBAC P18), and since F20 it ranks by
    // relevance rather than insertion order. Typing under 2 characters returns
    // nothing (the F20 minimum), so the picker asks for a query first.
    const [term, setTerm] = useState("");
    const { data: found, isFetching: searching } = useQuery({
        queryKey: ["dep-candidates", term],
        // `SearchType` is SINGULAR ("task"); an unknown token is silently
        // dropped by the service, which would search nothing at all.
        queryFn: () =>
            searchApi.search({ query: term, types: ["task"], limit: 20 }),
        enabled: !!showPicker && term.trim().length >= 2,
    });
    const listTasks = found?.tasks ?? [];

    const create = useMutation({
        // The stored edge is always (task_id BLOCKS related_task_id), so the
        // direction decides which end THIS task occupies.
        mutationFn: (input: {
            relatedTaskId: string;
            direction: "blocks" | "blocked_by";
        }) =>
            dependenciesApi.create(
                input.direction === "blocks"
                    ? { taskId, relatedTaskId: input.relatedTaskId }
                    : { taskId: input.relatedTaskId, relatedTaskId: taskId },
            ),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["deps", taskId] });
            setShowPicker(null);
            setPickedTaskId(undefined);
            setTerm("");
        },
    });

    const remove = useMutation({
        mutationFn: (id: string) => dependenciesApi.delete(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["deps", taskId] }),
    });

    const blocks = deps.filter((d) => d.type === "blocks");
    const blockedBy = deps.filter((d) => d.type === "blocked_by");

    const candidates = listTasks.filter(
        (t) =>
            t.id !== taskId &&
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
                {/* F25 (ISS-054): the component always held a
                    "blocks" | "blocked_by" state and rendered a Blocked-by
                    group, but the ONLY thing that opened the picker hardcoded
                    "blocks" and the mutation never read the direction — so the
                    Blocked-by half was unreachable. Two buttons, and the
                    mutation now maps the direction onto the stored edge. */}
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowRight size={12} strokeWidth={2} />}
                    onClick={() => setShowPicker("blocks")}
                    style={{ marginLeft: "auto" }}
                >
                    Blocks
                </Button>
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowLeft size={12} strokeWidth={2} />}
                    onClick={() => setShowPicker("blocked_by")}
                >
                    Blocked by
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
                        onSearch={setTerm}
                        searchValue={term}
                        filterOption={false}
                        loading={searching}
                        notFoundContent={
                            term.trim().length < 2
                                ? "Type at least 2 characters"
                                : searching
                                  ? "Searching…"
                                  : "No matching task"
                        }
                        placeholder={
                            showPicker === "blocks"
                                ? "Search any task this one blocks…"
                                : "Search any task that blocks this one…"
                        }
                        style={{ flex: 1 }}
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
                                direction: showPicker,
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
                            setTerm("");
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
    items: FlatDependency[];
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
                const other = d.otherTask;
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
                                background: "#94A3B8",
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
