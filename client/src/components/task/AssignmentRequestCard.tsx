import { useState } from "react";
import { Button, DatePicker, Input, Modal, Tooltip } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { CalendarClock, CornerDownRight, UserCheck } from "lucide-react";
import { useAuthStore } from "../../stores/auth";
import {
    useAssignmentRequestActions,
    useCanDecideRequest,
} from "../../hooks/useAssignmentRequests";
import { Avatar } from "../ui/Avatar";
import { tokens } from "../../theme";
import type { AssignmentRequest, User } from "../../types";

/**
 * ONE request, rendered identically in the task drawer and the Inbox
 * "Requests" tab (team-access P9). Which buttons appear mirrors the server
 * rule — the target, a Head of one of the target's teams, or an admin decide
 * (never the requester); the requester answers queries and may withdraw —
 * and the server remains the authority: a refused click surfaces its
 * human message via the shared mutation hooks.
 */

const STATUS_META: Record<
    AssignmentRequest["status"],
    { label: string; bg: string; fg: string }
> = {
    pending: { label: "Pending approval", bg: "#FEF3C7", fg: "#92400E" },
    accepted: { label: "Accepted", bg: "#D1FAE5", fg: "#065F46" },
    declined: { label: "Declined", bg: "#FEE2E2", fg: "#991B1B" },
    expired: { label: "Expired", bg: "#F1F5F9", fg: "#475569" },
    cancelled: { label: "Withdrawn", bg: "#F1F5F9", fg: "#475569" },
};

const nameOf = (u: User | null): string =>
    u ? `${u.firstName} ${u.lastName}`.trim() : "(removed)";

const agoOf = (iso: string): string => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const expiresIn = (iso: string): string => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "expired";
    const h = Math.ceil(ms / 3600_000);
    return h < 24 ? `expires in ${h}h` : `expires in ${Math.ceil(h / 24)}d`;
};

type ModalKind = "decline" | "query" | "answer" | null;

export const AssignmentRequestCard = ({
    request: r,
    showTask = false,
}: {
    request: AssignmentRequest;
    /** Inbox variant — leads with the task snapshot (name · team · due). */
    showTask?: boolean;
}) => {
    const me = useAuthStore((s) => s.user);
    const canDecide = useCanDecideRequest();
    const actions = useAssignmentRequestActions();
    const [modal, setModal] = useState<ModalKind>(null);
    const [note, setNote] = useState("");
    const [date, setDate] = useState<Dayjs | null>(null);

    const meta = STATUS_META[r.status];
    const isPending = r.status === "pending";
    const iAmRequester = !!me && r.requestedBy?.id === me.id;
    const iDecide = canDecide(r);
    const busy =
        actions.accept.isPending ||
        actions.decline.isPending ||
        actions.query.isPending ||
        actions.answer.isPending ||
        actions.cancel.isPending;

    const closeModal = (): void => {
        setModal(null);
        setNote("");
        setDate(null);
    };
    const submitModal = (): void => {
        if (modal === "decline") {
            actions.decline.mutate([r.id, note.trim() || undefined]);
        } else if (modal === "query") {
            if (!note.trim()) return;
            actions.query.mutate([
                r.id,
                note.trim(),
                date ? date.format("YYYY-MM-DD") : null,
            ]);
        } else if (modal === "answer") {
            if (!note.trim() && !date) return;
            actions.answer.mutate([
                r.id,
                {
                    ...(note.trim() ? { note: note.trim() } : {}),
                    ...(date ? { dueDate: date.format("YYYY-MM-DD") } : {}),
                },
            ]);
        }
        closeModal();
    };

    return (
        <div
            style={{
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.md,
                padding: tokens.spacing[3],
                background: tokens.colors.bgSurface,
            }}
        >
            {showTask && r.task && (
                <div style={{ marginBottom: 8 }}>
                    <div
                        style={{
                            fontWeight: 600,
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        {r.task.name}
                    </div>
                    <div
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            marginTop: 2,
                        }}
                    >
                        {r.task.spaceName} · {r.task.listName}
                        {r.task.dueDate ? ` · due ${r.task.dueDate}` : ""}
                    </div>
                </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar
                    name={nameOf(r.targetUser)}
                    src={r.targetUser?.avatarUrl ?? null}
                    size={22}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                        style={{
                            fontWeight: 600,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        {nameOf(r.targetUser)}
                    </span>
                    <span
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            marginLeft: 6,
                        }}
                    >
                        requested by {nameOf(r.requestedBy)} ·{" "}
                        {agoOf(r.createdAt)}
                        {isPending ? ` · ${expiresIn(r.expiresAt)}` : ""}
                    </span>
                </div>
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: tokens.radius.full,
                        background: meta.bg,
                        color: meta.fg,
                        whiteSpace: "nowrap",
                    }}
                >
                    {meta.label}
                </span>
            </div>

            {r.requestNote && (
                <div
                    style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    “{r.requestNote}”
                </div>
            )}

            {r.queryNote && (
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "flex-start",
                        marginTop: 8,
                        padding: "6px 10px",
                        background: tokens.colors.bgPage,
                        borderRadius: tokens.radius.sm,
                        fontSize: 12,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    <CornerDownRight
                        size={12}
                        strokeWidth={1.75}
                        style={{ marginTop: 2, flexShrink: 0 }}
                    />
                    <div>
                        <strong>Query:</strong> “{r.queryNote}”
                        {r.proposedDueDate && (
                            <span
                                style={{
                                    marginLeft: 6,
                                    color: tokens.colors.textMuted,
                                }}
                            >
                                <CalendarClock
                                    size={11}
                                    strokeWidth={1.75}
                                    style={{
                                        verticalAlign: "-1px",
                                        marginRight: 3,
                                    }}
                                />
                                proposed {r.proposedDueDate}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {isPending && (iDecide || iAmRequester) && (
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 10,
                        flexWrap: "wrap",
                    }}
                >
                    {iDecide && (
                        <>
                            <Button
                                size="small"
                                type="primary"
                                icon={
                                    <UserCheck size={12} strokeWidth={1.75} />
                                }
                                loading={actions.accept.isPending}
                                disabled={busy}
                                onClick={() => actions.accept.mutate([r.id])}
                            >
                                Accept
                            </Button>
                            <Button
                                size="small"
                                danger
                                disabled={busy}
                                onClick={() => setModal("decline")}
                            >
                                Decline
                            </Button>
                            <Button
                                size="small"
                                disabled={busy}
                                onClick={() => setModal("query")}
                            >
                                Query…
                            </Button>
                        </>
                    )}
                    {iAmRequester && (
                        <>
                            <Button
                                size="small"
                                disabled={busy}
                                onClick={() => setModal("answer")}
                            >
                                Answer…
                            </Button>
                            <Tooltip title="Withdraw this request">
                                <Button
                                    size="small"
                                    danger
                                    type="text"
                                    disabled={busy}
                                    onClick={() =>
                                        actions.cancel.mutate([r.id])
                                    }
                                >
                                    Withdraw
                                </Button>
                            </Tooltip>
                        </>
                    )}
                </div>
            )}

            <Modal
                open={modal !== null}
                title={
                    modal === "decline"
                        ? "Decline this assignment?"
                        : modal === "query"
                          ? "Ask the requester"
                          : "Reply to the query"
                }
                okText={
                    modal === "decline"
                        ? "Decline"
                        : modal === "query"
                          ? "Send query"
                          : "Send reply"
                }
                okButtonProps={{
                    danger: modal === "decline",
                    disabled:
                        modal === "query"
                            ? !note.trim()
                            : modal === "answer"
                              ? !note.trim() && !date
                              : false,
                }}
                onOk={submitModal}
                onCancel={closeModal}
                destroyOnHidden
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        paddingTop: 4,
                    }}
                >
                    <Input.TextArea
                        rows={3}
                        maxLength={500}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                            modal === "decline"
                                ? "Why? (optional)"
                                : modal === "query"
                                  ? 'e.g. "I need 2 more days for this."'
                                  : "Your reply (optional if you move the date)"
                        }
                    />
                    {modal !== "decline" && (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 12,
                                    color: tokens.colors.textSecondary,
                                }}
                            >
                                {modal === "query"
                                    ? "Propose a new due date (optional):"
                                    : "Move the real due date (optional):"}
                            </span>
                            <DatePicker
                                size="small"
                                value={date}
                                onChange={(d) => setDate(d)}
                                minDate={dayjs().startOf("day")}
                            />
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
};
