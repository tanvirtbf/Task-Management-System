import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Empty, Spin } from "antd";
import { ChevronRight, Folder, ListChecks } from "lucide-react";
import { listsApi, spacesApi } from "../../http/api";
import { tokens } from "../../theme";

/**
 * P3 of MOBILE_REBUILD_PLAN.md — the space → list drill-down.
 *
 * Before this route existed, the only door to a list was the sidebar tree, and
 * the sidebar force-collapsed to a 56px rail below 640px with the tree in the
 * branch that never rendered. So on a phone there was **no way to open a list
 * at all** — the single worst finding of the mobile scan.
 *
 * A full-screen drill-down rather than an overlay drawer (D3): it inherits the
 * browser back stack, which already works in this app, and it does not add a
 * fourth overlay competing with the task drawer, sheets and popovers.
 *
 * Rows are 56px so a thumb lands on them, and the whole row is the target.
 */

const Row = ({
    icon,
    label,
    sub,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    onClick: () => void;
}) => (
    <button
        onClick={onClick}
        style={{
            width: "100%",
            minHeight: 56,
            display: "flex",
            alignItems: "center",
            gap: tokens.spacing[3],
            padding: `${tokens.spacing[2]}px ${tokens.spacing[4]}px`,
            background: "none",
            border: "none",
            borderBottom: `1px solid ${tokens.colors.border}`,
            cursor: "pointer",
            textAlign: "left",
            color: tokens.colors.textPrimary,
        }}
    >
        <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
            <span
                style={{
                    display: "block",
                    fontSize: 15,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {label}
            </span>
            {sub && (
                <span
                    style={{
                        display: "block",
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                    }}
                >
                    {sub}
                </span>
            )}
        </span>
        <ChevronRight
            size={18}
            strokeWidth={1.75}
            color={tokens.colors.textMuted}
            style={{ flexShrink: 0 }}
        />
    </button>
);

const Centered = ({ children }: { children: React.ReactNode }) => (
    <div style={{ padding: tokens.spacing[10], textAlign: "center" }}>
        {children}
    </div>
);

export const SpacesPage = () => {
    const navigate = useNavigate();
    const { spaceId } = useParams<{ spaceId?: string }>();

    const { data: spaces = [], isLoading: spacesLoading } = useQuery({
        queryKey: ["spaces"],
        queryFn: () => spacesApi.list(),
    });

    const { data: lists = [], isLoading: listsLoading } = useQuery({
        queryKey: ["lists", "space", spaceId],
        queryFn: () => listsApi.listBySpace(spaceId!),
        enabled: !!spaceId,
    });

    if (spaceId) {
        const space = spaces.find((s) => s.id === spaceId);
        const live = lists.filter((l) => !l.archivedAt);
        return (
            <div>
                {listsLoading ? (
                    <Centered>
                        <Spin />
                    </Centered>
                ) : live.length === 0 ? (
                    <Centered>
                        <Empty description="No lists in this space yet." />
                    </Centered>
                ) : (
                    live.map((l) => (
                        <Row
                            key={l.id}
                            icon={
                                <ListChecks
                                    size={18}
                                    strokeWidth={1.75}
                                    color={l.color ?? tokens.colors.primary}
                                />
                            }
                            label={l.name}
                            sub={space?.name}
                            onClick={() => navigate(`/s/${spaceId}/l/${l.id}`)}
                        />
                    ))
                )}
            </div>
        );
    }

    const live = spaces.filter((s) => !s.archivedAt);
    return (
        <div>
            {spacesLoading ? (
                <Centered>
                    <Spin />
                </Centered>
            ) : live.length === 0 ? (
                <Centered>
                    <Empty description="No spaces yet." />
                </Centered>
            ) : (
                live.map((s) => (
                    <Row
                        key={s.id}
                        icon={
                            <Folder
                                size={18}
                                strokeWidth={1.75}
                                color={s.color || tokens.colors.primary}
                            />
                        }
                        label={s.name}
                        onClick={() => navigate(`/spaces/${s.id}`)}
                    />
                ))
            )}
        </div>
    );
};

export default SpacesPage;
