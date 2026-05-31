import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton, Button, Input } from "antd";
import { MessageSquare, Send, Trash2, CornerDownRight } from "lucide-react";
import { commentsApi } from "../../http/api";
import { useAuthStore } from "../../stores/auth";
import { useUserMap } from "../../hooks/useReferenceData";
import { Avatar } from "../ui/Avatar";
import { EmptyState } from "../ui/EmptyState";
import { MentionRenderer } from "./MentionRenderer";
import { tokens } from "../../theme";

const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / (1000 * 60));
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export const CommentsSection = ({ taskId }: { taskId: string }) => {
    const user = useAuthStore((s) => s.user);
    const [body, setBody] = useState("");
    const [replyParent, setReplyParent] = useState<string | null>(null);
    const [replyBody, setReplyBody] = useState("");
    const qc = useQueryClient();
    const userMap = useUserMap();

    const { data: comments = [], isLoading } = useQuery({
        queryKey: ["comments", taskId],
        queryFn: () => commentsApi.byTask(taskId),
    });

    const createMutation = useMutation({
        mutationFn: (input: { text: string; parentId?: string | null }) =>
            commentsApi.create(taskId, {
                body: input.text,
                parentCommentId: input.parentId ?? null,
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["comments", taskId] });
            qc.invalidateQueries({ queryKey: ["tasks-by-list"] });
            setBody("");
            setReplyBody("");
            setReplyParent(null);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (commentId: string) => commentsApi.delete(commentId),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: ["comments", taskId] }),
    });

    const topLevel = comments.filter((c) => !c.parentCommentId);
    const repliesByParent = new Map<string, typeof comments>();
    for (const c of comments) {
        if (!c.parentCommentId) continue;
        const existing = repliesByParent.get(c.parentCommentId) ?? [];
        existing.push(c);
        repliesByParent.set(c.parentCommentId, existing);
    }

    const renderComment = (
        c: (typeof comments)[number],
        isReply = false,
    ) => {
        const author = userMap.get(c.authorId);
        const fullName = author
            ? `${author.firstName} ${author.lastName}`
            : "Unknown";
        return (
            <div
                key={c.id}
                style={{
                    display: "flex",
                    gap: tokens.spacing[2],
                    alignItems: "flex-start",
                    marginLeft: isReply ? 36 : 0,
                }}
            >
                <Avatar
                    name={fullName}
                    src={author?.avatarUrl}
                    size={isReply ? 22 : 28}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 6,
                            marginBottom: 2,
                        }}
                    >
                        <span
                            style={{
                                fontWeight: 600,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            {fullName}
                        </span>
                        <span
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            {timeAgo(c.createdAt)}
                        </span>
                        {!isReply && user && (
                            <button
                                onClick={() =>
                                    setReplyParent(
                                        replyParent === c.id ? null : c.id,
                                    )
                                }
                                style={smallBtn}
                                title="Reply"
                            >
                                <CornerDownRight
                                    size={12}
                                    strokeWidth={1.5}
                                />
                                Reply
                            </button>
                        )}
                        {c.authorId === user?.id && (
                            <button
                                onClick={() => deleteMutation.mutate(c.id)}
                                style={{
                                    ...smallBtn,
                                    marginLeft: isReply ? "auto" : 0,
                                }}
                                title="Delete comment"
                                aria-label="Delete comment"
                            >
                                <Trash2 size={12} strokeWidth={1.5} />
                            </button>
                        )}
                    </div>
                    <div
                        style={{
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textPrimary,
                            lineHeight: 1.5,
                        }}
                    >
                        <MentionRenderer body={c.body} />
                    </div>
                </div>
            </div>
        );
    };

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
                <MessageSquare size={11} strokeWidth={1.75} />
                Comments
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {comments.length}
                </span>
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: tokens.spacing[3],
                    marginBottom: tokens.spacing[4],
                }}
            >
                {isLoading ? (
                    <Skeleton active paragraph={{ rows: 3 }} avatar />
                ) : comments.length === 0 ? (
                    <EmptyState
                        icon={MessageSquare}
                        title="No comments yet"
                        description="Start a thread below. @mention to ping, #BUG-123 to cross-link."
                        compact
                    />
                ) : (
                    topLevel.map((c) => (
                        <div
                            key={c.id}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                            }}
                        >
                            {renderComment(c)}
                            {(repliesByParent.get(c.id) ?? []).map((r) =>
                                renderComment(r, true),
                            )}
                            {replyParent === c.id && user && (
                                <div
                                    style={{
                                        marginLeft: 36,
                                        display: "flex",
                                        gap: 6,
                                        alignItems: "flex-start",
                                    }}
                                >
                                    <Input.TextArea
                                        value={replyBody}
                                        onChange={(e) =>
                                            setReplyBody(e.target.value)
                                        }
                                        autoFocus
                                        autoSize={{ minRows: 1, maxRows: 4 }}
                                        placeholder={`Reply to ${
                                            userMap.get(c.authorId)
                                                ?.firstName ?? ""
                                        }… ⌘+Enter`}
                                        onKeyDown={(e) => {
                                            if (
                                                e.key === "Enter" &&
                                                (e.metaKey || e.ctrlKey) &&
                                                replyBody.trim()
                                            ) {
                                                createMutation.mutate({
                                                    text: replyBody.trim(),
                                                    parentId: c.id,
                                                });
                                            }
                                            if (e.key === "Escape") {
                                                setReplyParent(null);
                                                setReplyBody("");
                                            }
                                        }}
                                    />
                                    <Button
                                        size="small"
                                        type="primary"
                                        disabled={!replyBody.trim()}
                                        onClick={() =>
                                            createMutation.mutate({
                                                text: replyBody.trim(),
                                                parentId: c.id,
                                            })
                                        }
                                    >
                                        Reply
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {user && (
                <div
                    style={{
                        display: "flex",
                        gap: tokens.spacing[2],
                        alignItems: "flex-start",
                    }}
                >
                    <Avatar
                        name={`${user.firstName} ${user.lastName}`}
                        src={user.avatarUrl}
                        size={28}
                    />
                    <div style={{ flex: 1 }}>
                        <Input.TextArea
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            placeholder="Write a comment... @mention to ping, #BUG-1042 to cross-link.  ⌘+Enter sends."
                            autoSize={{ minRows: 2, maxRows: 8 }}
                            onKeyDown={(e) => {
                                if (
                                    e.key === "Enter" &&
                                    (e.metaKey || e.ctrlKey) &&
                                    body.trim()
                                ) {
                                    createMutation.mutate({ text: body.trim() });
                                }
                            }}
                        />
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                marginTop: 8,
                            }}
                        >
                            <Button
                                type="primary"
                                size="small"
                                icon={<Send size={12} strokeWidth={1.75} />}
                                disabled={!body.trim()}
                                loading={createMutation.isPending}
                                onClick={() =>
                                    createMutation.mutate({ text: body.trim() })
                                }
                            >
                                Comment
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const smallBtn: React.CSSProperties = {
    background: "transparent",
    border: 0,
    padding: 2,
    cursor: "pointer",
    color: tokens.colors.textMuted,
    fontSize: 11,
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
};
