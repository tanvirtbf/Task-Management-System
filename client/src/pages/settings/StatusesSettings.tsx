import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert } from "antd";
import { mockApi } from "../../lib/mock-api";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { lists } from "../../mocks/lists";
import { spacesById } from "../../mocks/spaces";
import { statuses as allStatuses } from "../../mocks/statuses";
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
    const { data: workspace } = useQuery({
        queryKey: ["workspace"],
        queryFn: () => mockApi.workspace.get(),
    });

    const grouped = useMemo(() => {
        const out = new Map<
            string,
            { listName: string; spaceName: string; statuses: typeof allStatuses }
        >();
        lists.forEach((l) => {
            const space = spacesById.get(l.spaceId);
            out.set(l.id, {
                listName: l.name,
                spaceName: space?.name ?? "—",
                statuses: allStatuses
                    .filter(
                        (s) => s.scopeType === "list" && s.scopeId === l.id,
                    )
                    .sort((a, b) => a.position - b.position),
            });
        });
        return Array.from(out.entries())
            .filter(([, info]) => info.statuses.length > 0)
            .sort(([, a], [, b]) =>
                `${a.spaceName} / ${a.listName}`.localeCompare(
                    `${b.spaceName} / ${b.listName}`,
                ),
            );
    }, []);

    if (!workspace) return <div>Loading...</div>;

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

            {grouped.map(([listId, info]) => (
                <SettingsSection
                    key={listId}
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
