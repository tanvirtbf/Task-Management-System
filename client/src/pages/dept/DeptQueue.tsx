import { useMemo, useState } from "react";
import {
    useInfiniteQuery,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
    Alert,
    App as AntApp,
    Avatar,
    Button,
    Empty,
    Input,
    Modal,
    Skeleton,
    Tabs,
    Tooltip,
} from "antd";
import { Check, CornerDownRight, Flag } from "lucide-react";
import { reviewsApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { useUserMap } from "../../hooks/useReferenceData";
import { TaskDetailDrawer } from "../../components/task/TaskDetailDrawer";
import { tokens } from "../../theme";
import { QUEUE_BUCKETS } from "./buckets";
import type {
    ReviewQueueBucket,
    ReviewQueueRow,
    ReviewVerdict,
} from "../../types";

/**
 * Dept Review V1 — P15: the review queue for /dept.
 *
 * Bucket tabs → cursor-following pages (`useInfiniteQuery` + "Load more" —
 * rule 6: pagination is FOLLOWED, never truncated). Review actions use the
 * NO-CACHE-WRITE mutation pattern (plan §5 rule 7): no optimistic cache
 * writes — the row's actions disable while pending, and settle invalidates
 * exactly `review-queue` + `review-summary` + `["task", id]`. (Deliberately
 * NOT `useUpdateTask` — its rollback misses the task-detail cache.)
 *
 * Rows open the shared TaskDetailDrawer with `listId={row.primaryListId}`
 * (the SprintBoardPage cross-list precedent) via a `?task=` search param.
 */

const relTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
};

interface DeptQueueProps {
    spaceId: string;
    bucket: ReviewQueueBucket;
    onBucketChange: (bucket: ReviewQueueBucket) => void;
    selectedMemberId: string | null;
}

export const DeptQueue = ({
    spaceId,
    bucket,
    onBucketChange,
    selectedMemberId,
}: DeptQueueProps) => {
    const queryClient = useQueryClient();
    const { message } = AntApp.useApp();
    const userMap = useUserMap();
    const [searchParams, setSearchParams] = useSearchParams();
    const [flagTarget, setFlagTarget] = useState<ReviewQueueRow | null>(null);
    const [flagNote, setFlagNote] = useState("");
    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

    const query = useInfiniteQuery({
        queryKey: [
            "review-queue",
            spaceId,
            bucket,
            selectedMemberId ?? "all",
        ],
        queryFn: ({ pageParam }) =>
            reviewsApi.queue(spaceId, {
                bucket,
                memberId: selectedMemberId ?? undefined,
                cursor: pageParam,
            }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last) =>
            last.pagination.hasMore
                ? (last.pagination.nextCursor ?? undefined)
                : undefined,
    });

    const rows = useMemo(
        () => (query.data?.pages ?? []).flatMap((p) => p.data),
        [query.data],
    );
    const total = query.data?.pages[0]?.pagination.totalEstimate ?? 0;

    const review = useMutation({
        mutationFn: (input: {
            taskId: string;
            status: ReviewVerdict;
            note?: string | null;
        }) =>
            reviewsApi.reviewTask(input.taskId, {
                status: input.status,
                note: input.note,
            }),
        onMutate: (v) => setPendingTaskId(v.taskId),
        onSuccess: (_r, v) =>
            message.success(
                v.status === "approved" ? "Task approved" : "Task flagged",
            ),
        onError: (err) => message.error(getApiErrorMessage(err)),
        onSettled: (_r, _e, v) => {
            setPendingTaskId(null);
            queryClient.invalidateQueries({
                queryKey: ["review-queue", spaceId],
            });
            queryClient.invalidateQueries({
                queryKey: ["review-summary", spaceId],
            });
            queryClient.invalidateQueries({ queryKey: ["task", v.taskId] });
        },
    });

    const openTaskId = searchParams.get("task");
    const openRow = rows.find((r) => r.id === openTaskId) ?? null;
    const openDrawer = (id: string) => {
        const next = new URLSearchParams(searchParams);
        next.set("task", id);
        setSearchParams(next);
    };
    const closeDrawer = () => {
        const next = new URLSearchParams(searchParams);
        next.delete("task");
        setSearchParams(next, { replace: true });
    };

    // Review actions only make sense on done-state buckets — the server 409s
    // a not-completed task anyway; hiding them avoids guaranteed errors.
    const showActions = bucket === "needs_review" || bucket === "flagged";

    return (
        <div
            data-testid="dept-queue"
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                padding: tokens.spacing[4],
            }}
        >
            <Tabs
                activeKey={bucket}
                onChange={(k) => onBucketChange(k as ReviewQueueBucket)}
                items={QUEUE_BUCKETS.map((b) => ({
                    key: b.key,
                    label:
                        b.key === bucket && !query.isLoading
                            ? `${b.label} (${total})`
                            : b.label,
                }))}
            />

            {query.isLoading ? (
                <Skeleton active paragraph={{ rows: 4 }} />
            ) : query.isError ? (
                <Alert
                    type="error"
                    showIcon
                    message="Couldn't load the review queue"
                    action={
                        <Button size="small" onClick={() => query.refetch()}>
                            Retry
                        </Button>
                    }
                />
            ) : rows.length === 0 ? (
                <Empty
                    description={
                        selectedMemberId
                            ? "Nothing here for this member."
                            : bucket === "needs_review"
                              ? "All caught up — no completed tasks waiting for review."
                              : "Nothing here right now."
                    }
                />
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    {rows.map((row, i) => {
                        const pending = pendingTaskId === row.id;
                        return (
                            <div
                                key={row.id}
                                data-testid="dept-queue-row"
                                onClick={() => openDrawer(row.id)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: tokens.spacing[3],
                                    // P2: the spacing tokens are numbers, so this emitted `padding: "12 8"`
                                    // with no units and the browser dropped it — these rows had
                                    // zero padding on every device.
                                    padding: `${tokens.spacing[3]}px ${tokens.spacing[2]}px`,
                                    borderTop:
                                        i === 0
                                            ? undefined
                                            : `1px solid ${tokens.colors.border}`,
                                    cursor: "pointer",
                                    opacity: pending ? 0.6 : 1,
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: tokens.spacing[2],
                                            flexWrap: "wrap",
                                        }}
                                    >
                                        {row.customId && (
                                            <span
                                                style={{
                                                    fontFamily:
                                                        tokens.typography
                                                            .fontFamilyMono,
                                                    fontSize:
                                                        tokens.typography
                                                            .fontSize.xs,
                                                    color: tokens.colors
                                                        .textMuted,
                                                }}
                                            >
                                                {row.customId}
                                            </span>
                                        )}
                                        <span
                                            style={{
                                                fontWeight: 500,
                                                color: tokens.colors
                                                    .textPrimary,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {row.name}
                                        </span>
                                        {row.review?.status === "flagged" &&
                                            row.review && (
                                                <span
                                                    style={{
                                                        display:
                                                            "inline-flex",
                                                        alignItems: "center",
                                                        gap: 4,
                                                        color: tokens.colors
                                                            .danger,
                                                        fontSize:
                                                            tokens.typography
                                                                .fontSize.xs,
                                                        fontWeight: 600,
                                                    }}
                                                >
                                                    <Flag
                                                        size={12}
                                                        strokeWidth={2}
                                                    />
                                                    flagged
                                                </span>
                                            )}
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: tokens.spacing[2],
                                            marginTop: 2,
                                            fontSize:
                                                tokens.typography.fontSize
                                                    .xs,
                                            color: tokens.colors.textMuted,
                                        }}
                                    >
                                        {row.parentTask && (
                                            <span
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 3,
                                                }}
                                            >
                                                <CornerDownRight size={11} />
                                                {row.parentTask.name}
                                            </span>
                                        )}
                                        {bucket === "needs_review" ||
                                        bucket === "flagged" ? (
                                            row.completedAt && (
                                                <span>
                                                    completed{" "}
                                                    {relTime(row.completedAt)}
                                                </span>
                                            )
                                        ) : (
                                            <span>
                                                due {row.dueDate ?? "—"}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <Avatar.Group max={{ count: 3 }} size="small">
                                    {row.assignees.map((uid) => {
                                        const u = userMap.get(uid);
                                        return (
                                            <Tooltip
                                                key={uid}
                                                title={
                                                    u
                                                        ? `${u.firstName} ${u.lastName}`
                                                        : uid
                                                }
                                            >
                                                <Avatar
                                                    size="small"
                                                    src={
                                                        u?.avatarUrl ??
                                                        undefined
                                                    }
                                                >
                                                    {(u?.firstName?.[0] ??
                                                        "?") +
                                                        (u?.lastName?.[0] ??
                                                            "")}
                                                </Avatar>
                                            </Tooltip>
                                        );
                                    })}
                                </Avatar.Group>

                                {showActions && (
                                    <div
                                        style={{
                                            display: "flex",
                                            gap: tokens.spacing[2],
                                            flexShrink: 0,
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <Button
                                            size="small"
                                            icon={
                                                <Check
                                                    size={13}
                                                    strokeWidth={2}
                                                />
                                            }
                                            disabled={pending}
                                            onClick={() =>
                                                review.mutate({
                                                    taskId: row.id,
                                                    status: "approved",
                                                })
                                            }
                                        >
                                            Approve
                                        </Button>
                                        <Button
                                            size="small"
                                            danger
                                            icon={
                                                <Flag
                                                    size={13}
                                                    strokeWidth={2}
                                                />
                                            }
                                            disabled={pending}
                                            onClick={() => {
                                                setFlagTarget(row);
                                                setFlagNote(
                                                    row.review?.status ===
                                                        "flagged"
                                                        ? ""
                                                        : "",
                                                );
                                            }}
                                        >
                                            Flag
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {query.hasNextPage && (
                        <Button
                            style={{ marginTop: tokens.spacing[3] }}
                            loading={query.isFetchingNextPage}
                            onClick={() => query.fetchNextPage()}
                        >
                            Load more ({rows.length} of {total})
                        </Button>
                    )}
                </div>
            )}

            {/* Flag modal — note ≤500 (server-mirrored cap) */}
            <Modal
                title={
                    flagTarget
                        ? `Flag "${flagTarget.name}"`
                        : "Flag task"
                }
                open={!!flagTarget}
                okText="Flag task"
                okButtonProps={{ danger: true }}
                onOk={() => {
                    if (!flagTarget) return;
                    review.mutate({
                        taskId: flagTarget.id,
                        status: "flagged",
                        note: flagNote.trim() ? flagNote.trim() : null,
                    });
                    setFlagTarget(null);
                    setFlagNote("");
                }}
                onCancel={() => {
                    setFlagTarget(null);
                    setFlagNote("");
                }}
            >
                <p
                    style={{
                        marginTop: 0,
                        color: tokens.colors.textSecondary,
                        fontSize: tokens.typography.fontSize.sm,
                    }}
                >
                    The assignees are notified and see this note on the task.
                </p>
                <Input.TextArea
                    rows={3}
                    maxLength={500}
                    showCount
                    placeholder="What needs another pass? (optional)"
                    value={flagNote}
                    onChange={(e) => setFlagNote(e.target.value)}
                />
            </Modal>

            <TaskDetailDrawer
                taskId={openTaskId}
                listId={openRow?.primaryListId ?? ""}
                onClose={closeDrawer}
            />
        </div>
    );
};
