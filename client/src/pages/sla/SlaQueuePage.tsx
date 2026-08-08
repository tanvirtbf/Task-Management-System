import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Empty, Skeleton, Table, Tag as AntTag } from "antd";
import { AlarmClock } from "lucide-react";
import { slaApi } from "../../http/api";
import { tokens } from "../../theme";
import type { SlaBreach } from "../../types";

/**
 * `/sla` — the breached-SLA queue (F28, ISS-082, decision D12.4).
 *
 * `GET /api/v1/sla/breached` shipped complete and tested on the server and had
 * **zero callers**. There was no `slaApi` in the client at all: the whole
 * escalation feature reached a user only as a badge on one task's drawer, so
 * the question it was built to answer — *what is blowing its SLA right now?* —
 * could not be asked from any screen.
 *
 * ISS-082 asked for this to be sequenced AFTER the clock fix, because a UI on a
 * report that was six hours wrong would make the error more visible rather than
 * less. F3 pinned the session to UTC and F4 verified the arithmetic, so the
 * numbers here are correct. F28 also put SLA deadlines on the business clock
 * (D12.2), so a deadline in this table is one the team could actually have met.
 *
 * Reachable from the sidebar and from Home's `slaBreaches` KPI, which F24 made
 * truthful and which until now linked nowhere.
 */

/** "6h 12m" — minutes are what the endpoint returns, hours are what people read. */
const formatOverdue = (minutes: number): string => {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
};

/** Past ~1 day late is a different conversation from 20 minutes late. */
const severityColor = (minutes: number): string =>
    minutes >= 24 * 60
        ? tokens.colors.danger
        : minutes >= 4 * 60
          ? tokens.colors.warning
          : tokens.colors.textSecondary;

const SlaQueuePage = () => {
    const { data = [], isLoading } = useQuery({
        queryKey: ["sla", "breached"],
        queryFn: () => slaApi.breached(),
        // A breach queue that is minutes stale is misleading in an escalation
        // conversation; this is a small, workspace-scoped read.
        refetchInterval: 60_000,
    });

    const columns = [
        {
            title: "Task",
            dataIndex: "name",
            key: "name",
            render: (_: unknown, row: SlaBreach) => (
                // Link by `taskId`, never `customId`: /t/:taskKey resolves
                // through `tasksApi.getById`, which is GET /tasks/:id and does
                // not accept a custom id. The custom id is a LABEL here.
                <Link
                    to={`/t/${row.taskId}`}
                    style={{ color: tokens.colors.textPrimary, fontWeight: 500 }}
                >
                    {row.customId && (
                        <span
                            style={{
                                fontFamily: tokens.typography.fontFamilyMono,
                                color: tokens.colors.textMuted,
                                marginRight: 8,
                                fontSize: tokens.typography.fontSize.sm,
                            }}
                        >
                            {row.customId}
                        </span>
                    )}
                    {row.name}
                </Link>
            ),
        },
        {
            title: "Overdue by",
            dataIndex: "minutesBreached",
            key: "minutesBreached",
            width: 140,
            sorter: (a: SlaBreach, b: SlaBreach) =>
                a.minutesBreached - b.minutesBreached,
            defaultSortOrder: "descend" as const,
            render: (minutes: number) => (
                <span
                    style={{
                        fontFamily: tokens.typography.fontFamilyMono,
                        fontWeight: 600,
                        color: severityColor(minutes),
                    }}
                >
                    {formatOverdue(minutes)}
                </span>
            ),
        },
        {
            title: "Deadline",
            dataIndex: "slaDueAt",
            key: "slaDueAt",
            width: 200,
            render: (iso: string) => (
                <span style={{ color: tokens.colors.textSecondary }}>
                    {new Date(iso).toLocaleString()}
                </span>
            ),
        },
        {
            title: "Assignees",
            key: "assignees",
            render: (_: unknown, row: SlaBreach) =>
                row.assignees.length === 0 ? (
                    // Worth showing rather than hiding: a breached task with
                    // nobody on it is the most actionable row in the table.
                    <span style={{ color: tokens.colors.danger }}>
                        Unassigned
                    </span>
                ) : (
                    row.assignees.map((u) => (
                        <AntTag key={u.id} style={{ marginInlineEnd: 4 }}>
                            {`${u.firstName} ${u.lastName}`.trim() || u.email}
                        </AntTag>
                    ))
                ),
        },
    ];

    return (
        <div style={{ padding: tokens.spacing[6] }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[2],
                    marginBottom: tokens.spacing[2],
                }}
            >
                <AlarmClock size={18} strokeWidth={1.75} />
                <h1
                    style={{
                        margin: 0,
                        fontSize: tokens.typography.fontSize.xl,
                        fontWeight: 600,
                    }}
                >
                    SLA breaches
                </h1>
            </div>
            <p
                style={{
                    color: tokens.colors.textSecondary,
                    marginTop: 0,
                    marginBottom: tokens.spacing[5],
                    fontSize: tokens.typography.fontSize.sm,
                }}
            >
                Bugs and complaints past their deadline and not yet done.
                Deadlines are counted in working hours, so everything here had
                time on the clock.
            </p>

            {isLoading ? (
                <Skeleton active paragraph={{ rows: 6 }} />
            ) : data.length === 0 ? (
                <Empty description="Nothing is breaching its SLA." />
            ) : (
                <Table<SlaBreach>
                    rowKey="taskId"
                    dataSource={data}
                    columns={columns}
                    size="small"
                    pagination={false}
                />
            )}
        </div>
    );
};

export default SlaQueuePage;
