import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Alert } from "antd";
import { listsApi, statusesApi } from "../../http/api";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { useSpaceMap } from "../../hooks/useReferenceData";
import { LoadingState } from "../../components/shared/LoadingState";
import { tokens } from "../../theme";

const GROUP_LABELS = {
    not_started: "Not started",
    active: "Active",
    done: "Done",
    closed: "Closed",
} as const;

const GROUP_COLORS = {
    not_started: "#94A3B8",
    active: "#4F46E5",
    done: "#10B981",
    closed: "#64748B",
} as const;

const StatusesSettings = () => {
    const spaceMap = useSpaceMap();

    const { data: lists = [], isLoading } = useQuery({
        queryKey: ["lists"],
        queryFn: () => listsApi.listAll(),
    });

    // Statuses are per-list (`GET /lists/:listId/statuses`) — fan out one query
    // per list so this overview can show every list's workflow.
    const statusQueries = useQueries({
        queries: lists.map((l) => ({
            queryKey: ["statuses", l.id],
            queryFn: () => statusesApi.byList(l.id),
        })),
    });

    const grouped = useMemo(() => {
        return lists
            .map((l, i) => ({
                listId: l.id,
                listName: l.name,
                spaceName: spaceMap.get(l.spaceId)?.name ?? "—",
                statuses: (statusQueries[i]?.data ?? [])
                    .slice()
                    .sort((a, b) => a.position - b.position),
            }))
            .filter((info) => info.statuses.length > 0)
            .sort((a, b) =>
                `${a.spaceName} / ${a.listName}`.localeCompare(
                    `${b.spaceName} / ${b.listName}`,
                ),
            );
    }, [lists, statusQueries, spaceMap]);

    if (isLoading) return <LoadingState />;

    return (
        <div>
            <SettingsHeader
                title="Statuses"
                description="Per-list status workflows. Edit a list's settings to change its statuses."
            />

            <Alert
                type="info"
                message="Statuses are configured per list in the current implementation."
                description="Open any list, click the status header, and choose ‘Edit statuses’ to add/rename/recolor."
                showIcon
                style={{ marginBottom: tokens.spacing[3] }}
            />

            {grouped.map((info) => (
                <SettingsSection
                    key={info.listId}
                    title={`${info.spaceName} / ${info.listName}`}
                >
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            alignItems: "center",
                        }}
                    >
                        {info.statuses.map((s, i) => (
                            <span
                                key={s.id}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                }}
                            >
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        background: `${s.color}1A`,
                                        color: s.color,
                                        padding: "3px 9px",
                                        borderRadius: tokens.radius.full,
                                        fontSize: 12,
                                        fontWeight: 600,
                                        border: `1px solid ${s.color}33`,
                                    }}
                                    title={`Group: ${GROUP_LABELS[s.statusGroup]}`}
                                >
                                    <span
                                        style={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: "50%",
                                            background:
                                                GROUP_COLORS[s.statusGroup],
                                        }}
                                    />
                                    {s.name}
                                </span>
                                {i < info.statuses.length - 1 && (
                                    <span
                                        style={{
                                            color: tokens.colors.textMuted,
                                            fontSize: 11,
                                        }}
                                    >
                                        →
                                    </span>
                                )}
                            </span>
                        ))}
                    </div>
                </SettingsSection>
            ))}
        </div>
    );
};

export default StatusesSettings;
