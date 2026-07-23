import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
    Alert,
    App as AntApp,
    Avatar,
    Button,
    Input,
    Skeleton,
    Table,
    Tag,
    Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
    ArrowDownRight,
    ArrowLeft,
    ArrowUpRight,
    Check,
    CornerDownRight,
    Flag,
    Pencil,
    RefreshCw,
} from "lucide-react";
import { reportsApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { useSpaceMap, useUserMap } from "../../hooks/useReferenceData";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";
import type { DeptReportFlag, DeptReportMember } from "../../types";

/**
 * Dept Review V1 — P25: the full report detail (print-friendly; the global
 * @media print rules strip the AppShell chrome and `.no-print` extras).
 *
 * Renders the §3 payload snapshot: member matrix (per-assignee rows;
 * Unassigned last, deactivated muted), deduped totals with prev-week delta
 * arrows ("—" when no previous row — never recomputed), the flags record,
 * the head-accountability line (incl. self-reviewed transparency), the
 * head's note, and the H-13 "Updated after ack" chip. P26 adds the action
 * bar (all `.no-print`): Mark seen (admin/owner, first-wins ack), Regenerate
 * (admin or CURRENT head, confirm modal — §2.5 keeps note/ack/notified),
 * and the inline head-note editor (SNAPSHOT head only, 1000-char counter,
 * empty text clears to null).
 */

const fmtInstant = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });

const Delta = ({
    now,
    prev,
    goodWhenDown,
}: {
    now: number;
    prev: number | null;
    goodWhenDown?: boolean;
}) => {
    if (prev === null) {
        return (
            <span
                style={{
                    color: tokens.colors.textMuted,
                    fontSize: tokens.typography.fontSize.xs,
                }}
            >
                — no previous week
            </span>
        );
    }
    const diff = now - prev;
    if (diff === 0) {
        return (
            <span
                style={{
                    color: tokens.colors.textMuted,
                    fontSize: tokens.typography.fontSize.xs,
                }}
            >
                ±0 vs last week
            </span>
        );
    }
    const up = diff > 0;
    const good = goodWhenDown ? !up : up;
    const Icon = up ? ArrowUpRight : ArrowDownRight;
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                color: good ? tokens.colors.success : tokens.colors.danger,
                fontSize: tokens.typography.fontSize.xs,
                fontWeight: 600,
            }}
        >
            <Icon size={12} strokeWidth={2} />
            {up ? "+" : ""}
            {diff} vs last week
        </span>
    );
};

const StatBlock = ({
    label,
    value,
    sub,
}: {
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
}) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[4],
            minWidth: 150,
            flex: 1,
        }}
    >
        <div
            style={{
                fontSize: tokens.typography.fontSize.sm,
                color: tokens.colors.textSecondary,
                fontWeight: 500,
            }}
        >
            {label}
        </div>
        <div
            style={{
                fontFamily: tokens.typography.fontFamilyMono,
                fontSize: tokens.typography.fontSize["2xl"],
                fontWeight: 700,
                color: tokens.colors.textPrimary,
                lineHeight: 1.2,
            }}
        >
            {value}
        </div>
        {sub && <div style={{ marginTop: 2 }}>{sub}</div>}
    </div>
);

const memberKey = (m: DeptReportMember): string =>
    m.user?.id ?? "unassigned";

const ReportDetailPage = () => {
    const { reportId } = useParams();
    const spaceMap = useSpaceMap();
    const userMap = useUserMap();
    const me = useAuthStore((s) => s.user);
    const queryClient = useQueryClient();
    const { message, modal } = AntApp.useApp();
    const [editingNote, setEditingNote] = useState(false);
    const [noteDraft, setNoteDraft] = useState("");

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["report", reportId],
        queryFn: () => reportsApi.getById(reportId as string),
        enabled: !!reportId,
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["report", reportId] });
        queryClient.invalidateQueries({ queryKey: ["reports"] });
    };
    const ack = useMutation({
        mutationFn: () => reportsApi.ack(reportId as string),
        onSuccess: () => message.success("Marked as seen"),
        onError: (err) => message.error(getApiErrorMessage(err)),
        onSettled: invalidate,
    });
    const regenerate = useMutation({
        mutationFn: (input: { spaceId: string; weekStart: string }) =>
            reportsApi.generate(input),
        onSuccess: () => message.success("Report refreshed with current data"),
        onError: (err) => message.error(getApiErrorMessage(err)),
        onSettled: invalidate,
    });
    const saveNote = useMutation({
        mutationFn: (headNote: string | null) =>
            reportsApi.setNote(reportId as string, headNote),
        onSuccess: (_r, headNote) => {
            message.success(headNote ? "Note saved" : "Note removed");
            setEditingNote(false);
        },
        onError: (err) => message.error(getApiErrorMessage(err)),
        onSettled: invalidate,
    });

    // Flags duplicate across multi-assignee member rows — dedupe for the
    // department-level record (key = task + instant).
    const allFlags = useMemo(() => {
        if (!data) return [] as DeptReportFlag[];
        const seen = new Set<string>();
        const out: DeptReportFlag[] = [];
        for (const m of data.payload.members) {
            for (const f of m.flags) {
                const key = `${f.taskId}|${f.reviewedAt}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(f);
            }
        }
        return out.sort((a, b) =>
            b.reviewedAt.localeCompare(a.reviewedAt),
        );
    }, [data]);

    if (isLoading) {
        return (
            <div
                style={{
                    padding: tokens.spacing[6],
                    maxWidth: 940,
                    margin: "0 auto",
                }}
            >
                <Skeleton active paragraph={{ rows: 8 }} />
            </div>
        );
    }
    if (isError || !data) {
        const status = (error as { response?: { status?: number } })
            ?.response?.status;
        return (
            <div
                style={{
                    padding: tokens.spacing[6],
                    maxWidth: 720,
                    margin: "0 auto",
                }}
            >
                <Alert
                    type="error"
                    showIcon
                    message={
                        status === 403
                            ? "You don't have access to this report"
                            : status === 404
                              ? "This report doesn't exist"
                              : "Couldn't load the report"
                    }
                    action={
                        status !== 403 && status !== 404 ? (
                            <Button size="small" onClick={() => refetch()}>
                                Retry
                            </Button>
                        ) : undefined
                    }
                />
                <div style={{ marginTop: tokens.spacing[3] }}>
                    <Link to="/reports">← Back to reports</Link>
                </div>
            </div>
        );
    }

    const space = spaceMap.get(data.spaceId);
    const p = data.payload;
    const t = p.totals;
    const acked = !!data.acknowledgedAt;
    const updatedAfterAck =
        acked && data.generatedAt > (data.acknowledgedAt as string);
    const ackUser = data.acknowledgedBy
        ? userMap.get(data.acknowledgedBy)
        : null;
    const generator = data.generatedBy
        ? userMap.get(data.generatedBy)
        : null;

    // Gates mirror the server exactly: ack = admin/owner (👑); regenerate =
    // admin OR the space's CURRENT head; note = the SNAPSHOT head only (A-9 —
    // a later head can't edit a predecessor's report).
    const isAdmin = me?.role === "owner" || me?.role === "admin";
    const isCurrentHead =
        !!me && !!space?.headUserId && space.headUserId === me.id;
    const canRegenerate = isAdmin || isCurrentHead;
    const canEditNote = !!me && !!data.headUserId && data.headUserId === me.id;

    const startNoteEdit = () => {
        setNoteDraft(data.headNote ?? "");
        setEditingNote(true);
    };
    const submitNote = () => {
        const v = noteDraft.trim();
        saveNote.mutate(v === "" ? null : v);
    };
    const confirmRegenerate = () => {
        modal.confirm({
            title: "Regenerate this report?",
            content:
                "The numbers are recomputed from current data. The head's note and Seen status are kept, and nobody is notified again.",
            okText: "Regenerate",
            onOk: async () => {
                try {
                    await regenerate.mutateAsync({
                        spaceId: data.spaceId,
                        weekStart: data.weekStart,
                    });
                } catch {
                    // toast already shown by the mutation's onError
                }
            },
        });
    };

    const columns: ColumnsType<DeptReportMember> = [
        {
            title: "Member",
            key: "member",
            render: (_, m) => {
                if (!m.user) {
                    return (
                        <span style={{ color: tokens.colors.textMuted }}>
                            Unassigned tasks
                        </span>
                    );
                }
                return (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: tokens.spacing[2],
                            opacity: m.user.isActive ? 1 : 0.55,
                        }}
                    >
                        <Avatar
                            size="small"
                            src={m.user.avatarUrl ?? undefined}
                        >
                            {(m.user.firstName?.[0] ?? "") +
                                (m.user.lastName?.[0] ?? "")}
                        </Avatar>
                        <span
                            style={{
                                fontWeight: 500,
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            {m.user.firstName} {m.user.lastName}
                        </span>
                        {!m.user.isActive && (
                            <span
                                style={{
                                    fontSize: tokens.typography.fontSize.xs,
                                    color: tokens.colors.textMuted,
                                }}
                            >
                                (deactivated)
                            </span>
                        )}
                    </div>
                );
            },
        },
        {
            title: "Open",
            dataIndex: "assignedOpen",
            align: "right",
            width: 80,
        },
        {
            title: "Completed",
            key: "completed",
            align: "right",
            width: 120,
            render: (_, m) => (
                <span>
                    {m.completed}
                    {m.completedLate > 0 && (
                        <span
                            style={{
                                color: tokens.colors.warning,
                                fontSize: tokens.typography.fontSize.xs,
                            }}
                        >
                            {" "}
                            ({m.completedLate} late)
                        </span>
                    )}
                </span>
            ),
        },
        {
            title: "Overdue",
            dataIndex: "overdueNow",
            align: "right",
            width: 92,
        },
        {
            title: "Approved",
            dataIndex: "approved",
            align: "right",
            width: 100,
        },
        { title: "Flagged", dataIndex: "flagged", align: "right", width: 92 },
    ];

    return (
        <div
            data-testid="report-detail"
            style={{
                padding: tokens.spacing[6],
                maxWidth: 940,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[5],
            }}
        >
            <Link
                className="no-print"
                to="/reports"
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: tokens.colors.textSecondary,
                    fontSize: tokens.typography.fontSize.sm,
                }}
            >
                <ArrowLeft size={14} /> All reports
            </Link>

            {/* Header */}
            <div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: tokens.spacing[2],
                        flexWrap: "wrap",
                    }}
                >
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["2xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        {space?.name ?? "Department"} — weekly report
                    </h1>
                    {updatedAfterAck ? (
                        <Tag color="warning">Updated after ack</Tag>
                    ) : acked ? (
                        <Tag
                            color="success"
                            icon={
                                <Check
                                    size={11}
                                    strokeWidth={2.5}
                                    style={{ verticalAlign: -1 }}
                                />
                            }
                        >
                            Seen
                            {ackUser ? ` by ${ackUser.firstName}` : ""}
                        </Tag>
                    ) : (
                        <Tag color="processing">New</Tag>
                    )}
                    <div
                        className="no-print"
                        style={{
                            marginLeft: "auto",
                            display: "flex",
                            gap: tokens.spacing[2],
                        }}
                    >
                        {canEditNote && !data.headNote && !editingNote && (
                            <Button
                                size="small"
                                data-testid="add-note-btn"
                                icon={
                                    <Pencil
                                        size={13}
                                        style={{ verticalAlign: -2 }}
                                    />
                                }
                                onClick={startNoteEdit}
                            >
                                Add note
                            </Button>
                        )}
                        {canRegenerate && (
                            <Button
                                size="small"
                                data-testid="regenerate-btn"
                                icon={
                                    <RefreshCw
                                        size={13}
                                        style={{ verticalAlign: -2 }}
                                    />
                                }
                                loading={regenerate.isPending}
                                onClick={confirmRegenerate}
                            >
                                Regenerate
                            </Button>
                        )}
                        {isAdmin && !acked && (
                            <Button
                                size="small"
                                type="primary"
                                data-testid="mark-seen-btn"
                                icon={
                                    <Check
                                        size={13}
                                        strokeWidth={2.5}
                                        style={{ verticalAlign: -2 }}
                                    />
                                }
                                loading={ack.isPending}
                                onClick={() => ack.mutate()}
                            >
                                Mark seen
                            </Button>
                        )}
                    </div>
                </div>
                <p
                    style={{
                        margin: 0,
                        marginTop: 4,
                        color: tokens.colors.textSecondary,
                        fontSize: tokens.typography.fontSize.sm,
                    }}
                >
                    {data.weekStart} – {data.weekEnd}
                    {data.head
                        ? ` · Head: ${data.head.firstName} ${data.head.lastName}`
                        : " · No head assigned"}
                    {" · Generated "}
                    {fmtInstant(data.generatedAt)}
                    {generator
                        ? ` by ${generator.firstName} ${generator.lastName}`
                        : " automatically"}
                </p>
            </div>

            {/* Totals + deltas (task-level DEDUPED — not the member-row sum) */}
            <div
                style={{
                    display: "flex",
                    gap: tokens.spacing[3],
                    flexWrap: "wrap",
                }}
            >
                <StatBlock
                    label="Completed"
                    value={t.completed}
                    sub={
                        <Delta now={t.completed} prev={p.prevWeek?.completed ?? null} />
                    }
                />
                <StatBlock
                    label="Late completions"
                    value={t.completedLate}
                />
                <StatBlock
                    label="Overdue now"
                    value={t.overdueNow}
                    sub={
                        <Delta
                            now={t.overdueNow}
                            prev={p.prevWeek?.overdueNow ?? null}
                            goodWhenDown
                        />
                    }
                />
                <StatBlock label="Approved" value={t.approved} />
                <StatBlock label="Flagged" value={t.flagged} />
            </div>

            {/* Head accountability */}
            <div
                style={{
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    padding: tokens.spacing[3],
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textSecondary,
                }}
            >
                Head activity this week:{" "}
                <strong style={{ color: tokens.colors.textPrimary }}>
                    {p.headAccountability.reviewsDone} review
                    {p.headAccountability.reviewsDone === 1 ? "" : "s"}
                </strong>
                {p.headAccountability.selfReviewed > 0 &&
                    ` (${p.headAccountability.selfReviewed} self-reviewed)`}
                {" · "}
                {p.headAccountability.doneUnreviewedAtGeneration} completed
                task
                {p.headAccountability.doneUnreviewedAtGeneration === 1
                    ? ""
                    : "s"}{" "}
                still awaiting review.
            </div>

            {/* Head note (P26: the snapshot head edits it inline; clearing
                the text removes the note — head_note: null on the wire) */}
            {(data.headNote || editingNote) && (
                <div
                    style={{
                        borderLeft: `3px solid ${tokens.colors.primary}`,
                        background: `${tokens.colors.primary}0D`,
                        borderRadius: tokens.radius.md,
                        padding: tokens.spacing[3],
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            marginBottom: 4,
                        }}
                    >
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.xs,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Head&apos;s note
                        </div>
                        {canEditNote && !editingNote && (
                            <Button
                                className="no-print"
                                type="text"
                                size="small"
                                data-testid="edit-note-btn"
                                style={{ marginLeft: "auto" }}
                                icon={
                                    <Pencil
                                        size={12}
                                        style={{ verticalAlign: -2 }}
                                    />
                                }
                                onClick={startNoteEdit}
                            >
                                Edit
                            </Button>
                        )}
                    </div>
                    {editingNote ? (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: tokens.spacing[2],
                            }}
                        >
                            <Input.TextArea
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                maxLength={1000}
                                showCount
                                autoSize={{ minRows: 3, maxRows: 8 }}
                                placeholder="Context for HR — wins, risks, anything the numbers don't show…"
                                disabled={saveNote.isPending}
                                data-testid="head-note-input"
                            />
                            <div
                                style={{
                                    display: "flex",
                                    gap: tokens.spacing[2],
                                    justifyContent: "flex-end",
                                    // clears the absolutely-positioned
                                    // showCount counter under the textarea
                                    marginTop: tokens.spacing[5],
                                }}
                            >
                                <Button
                                    size="small"
                                    disabled={saveNote.isPending}
                                    onClick={() => setEditingNote(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="small"
                                    type="primary"
                                    data-testid="save-note-btn"
                                    loading={saveNote.isPending}
                                    onClick={submitNote}
                                >
                                    Save note
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div
                            style={{
                                whiteSpace: "pre-wrap",
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            {data.headNote}
                        </div>
                    )}
                </div>
            )}

            {/* Member matrix */}
            <div
                style={{
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    overflow: "hidden",
                }}
            >
                <Table<DeptReportMember>
                    size="small"
                    rowKey={memberKey}
                    columns={columns}
                    dataSource={p.members}
                    pagination={false}
                    locale={{
                        emptyText: "No member activity in this week.",
                    }}
                />
            </div>
            <div
                style={{
                    fontSize: tokens.typography.fontSize.xs,
                    color: tokens.colors.textMuted,
                    marginTop: -tokens.spacing[3],
                }}
            >
                Member rows count per assignee (a shared task appears on each
                assignee); the totals above are task-level and deduped.
                Open/overdue/awaiting-review are snapshots as of{" "}
                {fmtInstant(data.generatedAt)}.
            </div>

            {/* Flags record */}
            <div>
                <h2
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: tokens.colors.textMuted,
                        margin: 0,
                        marginBottom: tokens.spacing[3],
                    }}
                >
                    Flags this week ({allFlags.length})
                </h2>
                {allFlags.length === 0 ? (
                    <div
                        style={{
                            color: tokens.colors.textMuted,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        Nothing was flagged — clean week.
                    </div>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: tokens.spacing[2],
                        }}
                    >
                        {allFlags.map((f) => (
                            <div
                                key={`${f.taskId}|${f.reviewedAt}`}
                                style={{
                                    background: tokens.colors.bgSurface,
                                    border: `1px solid ${tokens.colors.border}`,
                                    borderLeft: `3px solid ${tokens.colors.danger}`,
                                    borderRadius: tokens.radius.md,
                                    padding: tokens.spacing[3],
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
                                    <Flag
                                        size={13}
                                        strokeWidth={2}
                                        color={tokens.colors.danger}
                                    />
                                    {f.customId && (
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
                                            {f.customId}
                                        </span>
                                    )}
                                    <Link
                                        to={`/t/${f.taskId}`}
                                        style={{
                                            fontWeight: 500,
                                            color: tokens.colors.textPrimary,
                                        }}
                                    >
                                        {f.taskName}
                                    </Link>
                                    {f.parentTask && (
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 3,
                                                fontSize:
                                                    tokens.typography
                                                        .fontSize.xs,
                                                color: tokens.colors
                                                    .textMuted,
                                            }}
                                        >
                                            <CornerDownRight size={11} />
                                            {f.parentTask.name}
                                        </span>
                                    )}
                                    <span
                                        style={{
                                            marginLeft: "auto",
                                            fontSize:
                                                tokens.typography.fontSize
                                                    .xs,
                                            color: tokens.colors.textMuted,
                                        }}
                                    >
                                        <Tooltip
                                            title={new Date(
                                                f.reviewedAt,
                                            ).toLocaleString()}
                                        >
                                            {f.reviewer
                                                ? `${f.reviewer.firstName} ${f.reviewer.lastName} · `
                                                : ""}
                                            {fmtInstant(f.reviewedAt)}
                                        </Tooltip>
                                    </span>
                                </div>
                                {f.note && (
                                    <div
                                        style={{
                                            marginTop: 6,
                                            fontSize:
                                                tokens.typography.fontSize
                                                    .sm,
                                            color: tokens.colors.textPrimary,
                                            whiteSpace: "pre-wrap",
                                        }}
                                    >
                                        {f.note}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportDetailPage;
