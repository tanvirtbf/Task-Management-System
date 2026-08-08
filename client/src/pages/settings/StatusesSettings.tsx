import { useMemo } from "react";
import {
    useQuery,
    useQueries,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import { Alert, Button, App as AntApp } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listsApi, statusesApi } from "../../http/api";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { useSpaceMap } from "../../hooks/useReferenceData";
import { usePermissions } from "../../hooks/usePermissions";
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

    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    // F26: only someone the server would let through sees the arrows.
    const { holds } = usePermissions();
    const canReorder = holds("status.manage");
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

    /**
     * F26 (ISS-038): the board's column order could not be changed. The server
     * endpoint has always worked and the client even had a typed wrapper —
     * `statusesApi.reorder` — with ZERO callers, so an admin who added a
     * status got it appended at the end forever.
     *
     * Move-left / move-right rather than drag-and-drop: the settings page is a
     * read-only summary today, this needs no new dependency, and F18 made the
     * endpoint demand a COMPLETE permutation with distinct positions — which
     * a swap satisfies by construction (a partial payload is now a 422).
     */
    const reorder = useMutation({
        mutationFn: ({
            listId,
            items,
        }: {
            listId: string;
            items: { id: string; position: number }[];
        }) => statusesApi.reorder(listId, items),
        onSuccess: (_data, vars) => {
            qc.invalidateQueries({ queryKey: ["statuses", vars.listId] });
        },
        onError: () => message.error("Could not reorder the statuses"),
    });

    const move = (
        listId: string,
        ordered: { id: string }[],
        from: number,
        to: number,
    ) => {
        if (to < 0 || to >= ordered.length) return;
        const next = ordered.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        // Send the FULL set with contiguous positions — the permutation the
        // endpoint requires.
        reorder.mutate({
            listId,
            items: next.map((st, idx) => ({ id: st.id, position: idx })),
        });
    };

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
                                {canReorder && (
                                    <span style={{ display: "inline-flex" }}>
                                        <Button
                                            type="text"
                                            size="small"
                                            disabled={i === 0 || reorder.isPending}
                                            title="Move earlier"
                                            onClick={() =>
                                                move(
                                                    info.listId,
                                                    info.statuses,
                                                    i,
                                                    i - 1,
                                                )
                                            }
                                            icon={
                                                <ChevronLeft
                                                    size={12}
                                                    strokeWidth={2}
                                                />
                                            }
                                        />
                                        <Button
                                            type="text"
                                            size="small"
                                            disabled={
                                                i === info.statuses.length - 1 ||
                                                reorder.isPending
                                            }
                                            title="Move later"
                                            onClick={() =>
                                                move(
                                                    info.listId,
                                                    info.statuses,
                                                    i,
                                                    i + 1,
                                                )
                                            }
                                            icon={
                                                <ChevronRight
                                                    size={12}
                                                    strokeWidth={2}
                                                />
                                            }
                                        />
                                    </span>
                                )}
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
