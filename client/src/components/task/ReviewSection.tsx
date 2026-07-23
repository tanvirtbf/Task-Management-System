import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Input, Modal, Skeleton } from "antd";
import {
    Check,
    ChevronDown,
    ChevronRight,
    ClipboardCheck,
    Flag,
} from "lucide-react";
import { reviewsApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import {
    useListMap,
    useSpaceMap,
    useStatusMap,
    useUserMap,
} from "../../hooks/useReferenceData";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";
import type { ReviewVerdict, Task } from "../../types";

/**
 * Dept Review V1 — P16: the "Department review" section in the task drawer.
 * (Deliberately named to disambiguate from the dev-type "Reviewer" PR field.)
 *
 * Visibility: the current verdict badge renders for anyone who can open the
 * drawer (it rides on the task row); the note + history + actions are for the
 * privileged set — space head / owner / admin (act + read) and the task's
 * ASSIGNEES (read — D-5 transparency). For a viewer with no stake and no
 * verdict the section renders nothing (and never fires the A-5 fetch, which
 * would 403).
 *
 * Mutations follow the NO-CACHE-WRITE pattern (§5 rule 7) — invalidate
 * task + history + the space's queue/summary on settle.
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

interface ReviewSectionProps {
    task: Task;
    listId: string;
}

export const ReviewSection = ({ task, listId }: ReviewSectionProps) => {
    const me = useAuthStore((s) => s.user);
    const queryClient = useQueryClient();
    const { message } = AntApp.useApp();
    const userMap = useUserMap();
    const listMap = useListMap();
    const spaceMap = useSpaceMap();
    const statusMap = useStatusMap(listId);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [flagOpen, setFlagOpen] = useState(false);
    const [flagNote, setFlagNote] = useState("");

    const spaceId = listMap.get(task.primaryListId)?.spaceId ?? null;
    const space = spaceId ? spaceMap.get(spaceId) : undefined;
    const isAdmin = me?.role === "owner" || me?.role === "admin";
    const isHead = !!space && !!me && space.headUserId === me.id;
    const canReview = isAdmin || isHead;
    const isAssignee = !!me && task.assignees.includes(me.id);
    const canSeeDetails = canReview || isAssignee;

    const statusGroup = statusMap.get(task.statusId)?.statusGroup;
    const isDone = statusGroup === "done" || statusGroup === "closed";

    const history = useQuery({
        queryKey: ["task-reviews", task.id],
        queryFn: () => reviewsApi.listReviews(task.id),
        enabled: canSeeDetails,
    });

    const review = useMutation({
        mutationFn: (input: { status: ReviewVerdict; note?: string | null }) =>
            reviewsApi.reviewTask(task.id, input),
        onSuccess: (_r, v) =>
            message.success(
                v.status === "approved" ? "Task approved" : "Task flagged",
            ),
        onError: (err) => message.error(getApiErrorMessage(err)),
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["task", task.id] });
            queryClient.invalidateQueries({
                queryKey: ["task-reviews", task.id],
            });
            if (spaceId) {
                queryClient.invalidateQueries({
                    queryKey: ["review-queue", spaceId],
                });
                queryClient.invalidateQueries({
                    queryKey: ["review-summary", spaceId],
                });
            }
        },
    });

    // No stake, no verdict → nothing to show (and no 403-doomed fetch).
    if (!canSeeDetails && !task.reviewStatus) return null;

    const latest = history.data?.[0] ?? null;
    const note = latest?.note ?? null;
    const reviewer = task.reviewedBy
        ? (userMap.get(task.reviewedBy) ?? latest?.reviewer ?? null)
        : null;
    const approved = task.reviewStatus === "approved";

    return (
        <div
            data-testid="review-section"
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
                <ClipboardCheck size={11} strokeWidth={1.75} />
                Department review
            </div>

            {task.reviewStatus ? (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[2],
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: tokens.spacing[2],
                            flexWrap: "wrap",
                        }}
                    >
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                padding: "2px 10px",
                                borderRadius: 999,
                                fontSize: tokens.typography.fontSize.sm,
                                fontWeight: 600,
                                color: approved
                                    ? tokens.colors.success
                                    : tokens.colors.danger,
                                background: `${
                                    approved
                                        ? tokens.colors.success
                                        : tokens.colors.danger
                                }1A`,
                            }}
                        >
                            {approved ? (
                                <Check size={13} strokeWidth={2.5} />
                            ) : (
                                <Flag size={13} strokeWidth={2.5} />
                            )}
                            {approved ? "Approved" : "Flagged"}
                        </span>
                        <span
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textSecondary,
                            }}
                        >
                            {reviewer
                                ? `by ${reviewer.firstName} ${reviewer.lastName}`
                                : ""}
                            {task.reviewedAt
                                ? ` · ${relTime(task.reviewedAt)}`
                                : ""}
                        </span>
                    </div>
                    {canSeeDetails && note && (
                        <div
                            style={{
                                padding: tokens.spacing[3],
                                borderRadius: tokens.radius.md,
                                background: tokens.colors.bgHover,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textPrimary,
                                whiteSpace: "pre-wrap",
                            }}
                        >
                            {note}
                        </div>
                    )}
                </div>
            ) : (
                <div
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textMuted,
                    }}
                >
                    {canReview
                        ? isDone
                            ? "Awaiting your review."
                            : "Review opens once the task reaches a done status."
                        : "Not reviewed yet."}
                </div>
            )}

            {canReview && isDone && (
                <div
                    style={{
                        display: "flex",
                        gap: tokens.spacing[2],
                        marginTop: tokens.spacing[3],
                    }}
                >
                    <Button
                        size="small"
                        icon={<Check size={13} strokeWidth={2} />}
                        disabled={review.isPending}
                        onClick={() => review.mutate({ status: "approved" })}
                    >
                        Approve
                    </Button>
                    <Button
                        size="small"
                        danger
                        icon={<Flag size={13} strokeWidth={2} />}
                        disabled={review.isPending}
                        onClick={() => setFlagOpen(true)}
                    >
                        Flag
                    </Button>
                </div>
            )}

            {canSeeDetails && (
                <div style={{ marginTop: tokens.spacing[3] }}>
                    {history.isLoading ? (
                        <Skeleton
                            active
                            paragraph={{ rows: 1 }}
                            title={false}
                        />
                    ) : history.isError ? (
                        <span
                            style={{
                                fontSize: tokens.typography.fontSize.xs,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Couldn&apos;t load review history —{" "}
                            <Button
                                type="link"
                                size="small"
                                style={{ padding: 0, fontSize: "inherit" }}
                                onClick={() => history.refetch()}
                            >
                                retry
                            </Button>
                        </span>
                    ) : (history.data?.length ?? 0) > 0 ? (
                        <>
                            <button
                                onClick={() => setHistoryOpen((v) => !v)}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    background: "transparent",
                                    border: 0,
                                    padding: 0,
                                    cursor: "pointer",
                                    fontSize: tokens.typography.fontSize.xs,
                                    color: tokens.colors.textMuted,
                                }}
                            >
                                {historyOpen ? (
                                    <ChevronDown size={12} />
                                ) : (
                                    <ChevronRight size={12} />
                                )}
                                History ({history.data!.length})
                            </button>
                            {historyOpen && (
                                <div
                                    style={{
                                        marginTop: tokens.spacing[2],
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: tokens.spacing[2],
                                    }}
                                >
                                    {history.data!.map((r) => (
                                        <div
                                            key={r.id}
                                            style={{
                                                display: "flex",
                                                gap: tokens.spacing[2],
                                                fontSize:
                                                    tokens.typography.fontSize
                                                        .sm,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    color:
                                                        r.status === "approved"
                                                            ? tokens.colors
                                                                  .success
                                                            : tokens.colors
                                                                  .danger,
                                                    display: "inline-flex",
                                                    marginTop: 2,
                                                }}
                                            >
                                                {r.status === "approved" ? (
                                                    <Check
                                                        size={13}
                                                        strokeWidth={2}
                                                    />
                                                ) : (
                                                    <Flag
                                                        size={13}
                                                        strokeWidth={2}
                                                    />
                                                )}
                                            </span>
                                            <div style={{ minWidth: 0 }}>
                                                <span
                                                    style={{
                                                        color: tokens.colors
                                                            .textSecondary,
                                                    }}
                                                >
                                                    {r.reviewer
                                                        ? `${r.reviewer.firstName} ${r.reviewer.lastName}`
                                                        : "Someone"}{" "}
                                                    ·{" "}
                                                    {relTime(r.createdAt)}
                                                </span>
                                                {r.note && (
                                                    <div
                                                        style={{
                                                            color: tokens
                                                                .colors
                                                                .textPrimary,
                                                            whiteSpace:
                                                                "pre-wrap",
                                                        }}
                                                    >
                                                        {r.note}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : null}
                </div>
            )}

            <Modal
                title={`Flag "${task.name}"`}
                open={flagOpen}
                okText="Flag task"
                okButtonProps={{ danger: true }}
                onOk={() => {
                    review.mutate({
                        status: "flagged",
                        note: flagNote.trim() ? flagNote.trim() : null,
                    });
                    setFlagOpen(false);
                    setFlagNote("");
                }}
                onCancel={() => {
                    setFlagOpen(false);
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
        </div>
    );
};
