import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Select, DatePicker, Empty } from "antd";
import dayjs from "dayjs";
import { Clock, ExternalLink } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { usersById } from "../../mocks/users";
import { LoadingState } from "../../components/shared/LoadingState";
import { tokens } from "../../theme";

const { RangePicker } = DatePicker;

const formatHM = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
};

const TimeReportPage = () => {
    const navigate = useNavigate();
    const currentUser = useAuthStore((s) => s.user);
    const [userId, setUserId] = useState<string | undefined>(currentUser?.id);
    const [range, setRange] = useState<
        [dayjs.Dayjs, dayjs.Dayjs] | null
    >([dayjs().subtract(30, "day"), dayjs()]);

    const { data: users = [] } = useQuery({
        queryKey: ["users"],
        queryFn: () => mockApi.users.list(),
    });

    const { data: logs = [], isLoading } = useQuery({
        queryKey: ["time-logs-by-user", userId],
        queryFn: () =>
            userId ? mockApi.timeTracking.byUser(userId) : Promise.resolve([]),
        enabled: !!userId,
    });

    const filteredLogs = useMemo(() => {
        if (!range) return logs;
        const [from, to] = range;
        return logs.filter((l) => {
            const d = dayjs(l.startedAt);
            return d.isAfter(from.startOf("day")) && d.isBefore(to.endOf("day"));
        });
    }, [logs, range]);

    const total = filteredLogs.reduce((s, l) => s + l.durationSeconds, 0);
    const byDay = useMemo(() => {
        const m = new Map<string, number>();
        filteredLogs.forEach((l) => {
            const day = dayjs(l.startedAt).format("YYYY-MM-DD");
            m.set(day, (m.get(day) ?? 0) + l.durationSeconds);
        });
        return Array.from(m.entries()).sort(([a], [b]) =>
            b.localeCompare(a),
        );
    }, [filteredLogs]);

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1000,
                margin: "0 auto",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                    marginBottom: tokens.spacing[5],
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: tokens.radius.lg,
                        background: tokens.colors.primarySubtle,
                        color: tokens.colors.primary,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Clock size={22} strokeWidth={1.75} />
                </div>
                <div style={{ flex: 1 }}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["3xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                        }}
                    >
                        Time report
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        Per-user time logs across all tasks.
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div
                style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: tokens.spacing[4],
                }}
            >
                <Select
                    value={userId}
                    onChange={setUserId}
                    style={{ width: 240 }}
                    placeholder="Pick a user"
                    showSearch
                    optionFilterProp="label"
                    options={users
                        .filter((u) => u.status === "active")
                        .map((u) => ({
                            value: u.id,
                            label: `${u.firstName} ${u.lastName}${u.id === currentUser?.id ? " (me)" : ""}`,
                        }))}
                />
                <RangePicker
                    value={range}
                    onChange={(v) =>
                        setRange(
                            (v ?? null) as
                                | [dayjs.Dayjs, dayjs.Dayjs]
                                | null,
                        )
                    }
                    format="MMM D, YYYY"
                />
                <div
                    style={{
                        marginLeft: "auto",
                        background: tokens.colors.primarySubtle,
                        color: tokens.colors.primary,
                        padding: "6px 14px",
                        borderRadius: tokens.radius.md,
                        fontWeight: 700,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    Total: {formatHM(total)}
                </div>
            </div>

            {isLoading ? (
                <LoadingState />
            ) : filteredLogs.length === 0 ? (
                <Empty description="No time logs in this range." />
            ) : (
                <div
                    style={{
                        background: tokens.colors.bgSurface,
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.lg,
                        overflow: "hidden",
                    }}
                >
                    {byDay.map(([day, dayTotal]) => {
                        const dayLogs = filteredLogs.filter(
                            (l) =>
                                dayjs(l.startedAt).format("YYYY-MM-DD") ===
                                day,
                        );
                        return (
                            <div
                                key={day}
                                style={{
                                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                                }}
                            >
                                <div
                                    style={{
                                        padding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px`,
                                        background: tokens.colors.bgMuted,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        fontSize: 12,
                                        fontWeight: 600,
                                    }}
                                >
                                    <span>
                                        {dayjs(day).format(
                                            "dddd, MMM D, YYYY",
                                        )}
                                    </span>
                                    <span
                                        style={{
                                            fontFamily:
                                                tokens.typography
                                                    .fontFamilyMono,
                                            color: tokens.colors.primary,
                                        }}
                                    >
                                        {formatHM(dayTotal)}
                                    </span>
                                </div>
                                {dayLogs.map((l) => (
                                    <div
                                        key={l.id}
                                        onClick={() =>
                                            navigate(`/t/${l.taskId}`)
                                        }
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 12,
                                            padding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px`,
                                            cursor: "pointer",
                                            transition:
                                                "background var(--transition-fast)",
                                        }}
                                        onMouseEnter={(e) =>
                                            (e.currentTarget.style.background =
                                                tokens.colors.bgHover)
                                        }
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.background =
                                                "transparent")
                                        }
                                    >
                                        <span
                                            style={{
                                                fontFamily:
                                                    tokens.typography
                                                        .fontFamilyMono,
                                                fontWeight: 700,
                                                color: tokens.colors
                                                    .textPrimary,
                                                minWidth: 70,
                                            }}
                                        >
                                            {formatHM(l.durationSeconds)}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: 12,
                                                color: tokens.colors.textMuted,
                                                fontFamily:
                                                    tokens.typography
                                                        .fontFamilyMono,
                                                minWidth: 70,
                                            }}
                                        >
                                            {dayjs(l.startedAt).format(
                                                "HH:mm",
                                            )}
                                        </span>
                                        <span
                                            style={{
                                                flex: 1,
                                                fontSize: 13,
                                                color: tokens.colors
                                                    .textPrimary,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {l.note || (
                                                <em
                                                    style={{
                                                        color: tokens.colors
                                                            .textMuted,
                                                    }}
                                                >
                                                    No note
                                                </em>
                                            )}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: 11,
                                                color: tokens.colors.textMuted,
                                                fontFamily:
                                                    tokens.typography
                                                        .fontFamilyMono,
                                            }}
                                        >
                                            Task {l.taskId.slice(0, 8)}
                                        </span>
                                        <ExternalLink
                                            size={12}
                                            strokeWidth={1.75}
                                            color={tokens.colors.textMuted}
                                        />
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
            {/* Acknowledge that currentUser-only is the most common case */}
            {userId && !usersById.get(userId) && (
                <div style={{ marginTop: tokens.spacing[3] }}>
                    User not found.
                </div>
            )}
        </div>
    );
};

export default TimeReportPage;
