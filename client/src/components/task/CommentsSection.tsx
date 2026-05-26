import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton, Button, Input, Tooltip } from "antd";
import {
    MessageSquare,
    Send,
    Smile,
    Trash2,
    Pencil,
    Check,
    X,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { usersById } from "../../mocks/users";
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

const REACTIONS = ["👍", "✅", "🔥", "❤️", "👀", "🎉"];

export const CommentsSection = ({ taskId }: { taskId: string }) => {
    const user = useAuthStore((s) => s.user);
    const [body, setBody] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState("");
    const qc = useQueryClient();

    const { data: comments = [], isLoading } = useQuery({
        queryKey: ["comments", taskId],
        queryFn: () => mockApi.comments.byTask(taskId),
    });

    const createMutation = useMutation({
        mutationFn: (text: string) =>
            mockApi.comments.create(taskId, text, user!.id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["comments", taskId] });
            qc.invalidateQueries({ queryKey: ["tasks-by-list"] });
            setBody("");
        },
    });

    const reactMutation = useMutation({
        mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) =>
            mockApi.comments.toggleReaction(commentId, emoji, user!.id),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: ["comments", taskId] }),
    });

    const deleteMutation = useMutation({
        mutationFn: (commentId: string) => mockApi.comments.delete(commentId),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: ["comments", taskId] }),
    });

    const editMutation = useMutation({
        mutationFn: ({ id, body }: { id: string; body: string }) =>
            mockApi.comments.update(id, { body }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["comments", taskId] });
            setEditingId(null);
            setEditBody("");
        },
    });

    const startEdit = (id: string, currentBody: string) => {
        setEditingId(id);
        setEditBody(currentBody);
    };
    const cancelEdit = () => {
        setEditingId(null);
        setEditBody("");
    };
    const commitEdit = () => {
        if (!editingId) return;
        const trimmed = editBody.trim();
        if (!trimmed) return;
        editMutation.mutate({ id: editingId, body: trimmed });
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
                        description="Start a thread below."
                        compact
                    />
                ) : (
                    comments.map((c) => {
                        const author = usersById.get(c.authorId);
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
                                }}
                            >
                                <Avatar
                                    name={fullName}
                                    src={author?.avatarUrl}
                                    size={28}
                                />
                                <div
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                    }}
                                >
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
                                                fontSize:
                                                    tokens.typography.fontSize.sm,
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
                                            {c.editedAt && (
                                                <span
                                                    style={{
                                                        marginLeft: 4,
                                                        fontStyle: "italic",
                                                    }}
                                                >
                                                    (edited)
                                                </span>
                                            )}
                                        </span>
                                        {c.authorId === user?.id &&
                                            editingId !== c.id && (
                                                <span
                                                    style={{
                                                        marginLeft: "auto",
                                                        display:
                                                            "inline-flex",
                                                        gap: 2,
                                                    }}
                                                >
                                                    <button
                                                        onClick={() =>
                                                            startEdit(
                                                                c.id,
                                                                c.body,
                                                            )
                                                        }
                                                        style={
                                                            commentIconBtn
                                                        }
                                                        title="Edit comment"
                                                        aria-label="Edit comment"
                                                    >
                                                        <Pencil
                                                            size={12}
                                                            strokeWidth={1.5}
                                                        />
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            deleteMutation.mutate(
                                                                c.id,
                                                            )
                                                        }
                                                        style={
                                                            commentIconBtn
                                                        }
                                                        title="Delete comment"
                                                        aria-label="Delete comment"
                                                    >
                                                        <Trash2
                                                            size={12}
                                                            strokeWidth={1.5}
                                                        />
                                                    </button>
                                                </span>
                                            )}
                                    </div>
                                    {editingId === c.id ? (
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 6,
                                                marginTop: 4,
                                            }}
                                        >
                                            <Input.TextArea
                                                value={editBody}
                                                onChange={(e) =>
                                                    setEditBody(
                                                        e.target.value,
                                                    )
                                                }
                                                autoFocus
                                                autoSize={{
                                                    minRows: 2,
                                                    maxRows: 6,
                                                }}
                                                onKeyDown={(e) => {
                                                    if (
                                                        e.key === "Enter" &&
                                                        (e.metaKey ||
                                                            e.ctrlKey)
                                                    ) {
                                                        e.preventDefault();
                                                        commitEdit();
                                                    } else if (
                                                        e.key === "Escape"
                                                    ) {
                                                        e.preventDefault();
                                                        cancelEdit();
                                                    }
                                                }}
                                            />
                                            <div
                                                style={{
                                                    display: "flex",
                                                    justifyContent:
                                                        "flex-end",
                                                    gap: 6,
                                                }}
                                            >
                                                <Button
                                                    size="small"
                                                    onClick={cancelEdit}
                                                    icon={
                                                        <X
                                                            size={12}
                                                            strokeWidth={1.75}
                                                        />
                                                    }
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="primary"
                                                    size="small"
                                                    onClick={commitEdit}
                                                    disabled={
                                                        !editBody.trim()
                                                    }
                                                    loading={
                                                        editMutation.isPending
                                                    }
                                                    icon={
                                                        <Check
                                                            size={12}
                                                            strokeWidth={1.75}
                                                        />
                                                    }
                                                >
                                                    Save
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div
                                            style={{
                                                fontSize:
                                                    tokens.typography
                                                        .fontSize.sm,
                                                color: tokens.colors
                                                    .textPrimary,
                                                whiteSpace: "pre-wrap",
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            <MentionRenderer text={c.body} />
                                        </div>
                                    )}
                                    <CommentReactions
                                        comment={c}
                                        currentUserId={user?.id ?? ""}
                                        onToggle={(emoji) =>
                                            reactMutation.mutate({
                                                commentId: c.id,
                                                emoji,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Composer */}
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
                            placeholder="Write a comment... Press ⌘+Enter to send."
                            autoSize={{ minRows: 2, maxRows: 8 }}
                            onKeyDown={(e) => {
                                if (
                                    e.key === "Enter" &&
                                    (e.metaKey || e.ctrlKey) &&
                                    body.trim()
                                ) {
                                    createMutation.mutate(body.trim());
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
                                onClick={() => createMutation.mutate(body.trim())}
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

const commentIconBtn: React.CSSProperties = {
    background: "none",
    border: 0,
    padding: 2,
    cursor: "pointer",
    color: tokens.colors.textMuted,
    opacity: 0.5,
    display: "inline-flex",
};

const CommentReactions = ({
    comment,
    currentUserId,
    onToggle,
}: {
    comment: { reactions: { emoji: string; userIds: string[] }[] };
    currentUserId: string;
    onToggle: (emoji: string) => void;
}) => {
    const [picking, setPicking] = useState(false);

    return (
        <div
            style={{
                display: "flex",
                gap: 4,
                marginTop: 6,
                flexWrap: "wrap",
                alignItems: "center",
            }}
        >
            {comment.reactions.map((r) => {
                const isMe = r.userIds.includes(currentUserId);
                return (
                    <button
                        key={r.emoji}
                        onClick={() => onToggle(r.emoji)}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            padding: "2px 8px",
                            background: isMe
                                ? tokens.colors.primarySubtle
                                : tokens.colors.bgMuted,
                            border: `1px solid ${isMe ? tokens.colors.primary : "transparent"}`,
                            borderRadius: tokens.radius.full,
                            cursor: "pointer",
                            fontSize: 12,
                            color: isMe
                                ? tokens.colors.primary
                                : tokens.colors.textSecondary,
                            transition: "all var(--transition-base)",
                        }}
                    >
                        {r.emoji}
                        <span
                            style={{
                                fontFamily: tokens.typography.fontFamilyMono,
                                fontSize: 10,
                                fontWeight: 600,
                            }}
                        >
                            {r.userIds.length}
                        </span>
                    </button>
                );
            })}
            {picking ? (
                <div
                    style={{
                        display: "flex",
                        gap: 2,
                        padding: 2,
                        background: tokens.colors.bgSurface,
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.md,
                    }}
                >
                    {REACTIONS.map((emoji) => (
                        <button
                            key={emoji}
                            onClick={() => {
                                onToggle(emoji);
                                setPicking(false);
                            }}
                            style={{
                                background: "none",
                                border: 0,
                                cursor: "pointer",
                                fontSize: 16,
                                padding: 2,
                            }}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            ) : (
                <Tooltip title="Add reaction">
                    <button
                        onClick={() => setPicking(true)}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: 3,
                            background: "transparent",
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.full,
                            cursor: "pointer",
                            color: tokens.colors.textMuted,
                            opacity: 0.6,
                            transition: "opacity var(--transition-base)",
                        }}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.opacity = "1")
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.opacity = "0.6")
                        }
                    >
                        <Smile size={12} strokeWidth={1.75} />
                    </button>
                </Tooltip>
            )}
        </div>
    );
};
