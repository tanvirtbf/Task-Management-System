import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tooltip } from "antd";
import { mockApi } from "../../lib/mock-api";
import { useUiStore } from "../../stores/ui";
import { tokens } from "../../theme";
import { DynamicIcon } from "./DynamicIcon";

export const SidebarSpaceTree = ({ collapsed }: { collapsed: boolean }) => {
    const { data: spaces = [] } = useQuery({
        queryKey: ["spaces"],
        queryFn: () => mockApi.spaces.list(),
    });
    const { data: folders = [] } = useQuery({
        queryKey: ["folders"],
        queryFn: () => mockApi.folders.list(),
    });
    const { data: lists = [] } = useQuery({
        queryKey: ["lists"],
        queryFn: () => mockApi.lists.listAll(),
    });

    const { expandedIds, toggleExpanded } = useUiStore();
    const navigate = useNavigate();
    const location = useLocation();

    if (collapsed) {
        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    alignItems: "center",
                    padding: "8px 0",
                }}
            >
                {spaces.map((space) => (
                    <Tooltip key={space.id} title={space.name} placement="right">
                        <button
                            onClick={() => navigate(`/s/${space.id}`)}
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: tokens.radius.md,
                                background: `${space.color}1A`,
                                color: space.color,
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <DynamicIcon
                                name={space.icon}
                                size={16}
                                strokeWidth={1.75}
                            />
                        </button>
                    </Tooltip>
                ))}
            </div>
        );
    }

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 10px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    color: tokens.colors.textMuted,
                    textTransform: "uppercase",
                }}
            >
                <span>Spaces</span>
                <button
                    style={{
                        background: "none",
                        border: 0,
                        color: tokens.colors.textMuted,
                        cursor: "pointer",
                        padding: 2,
                        display: "flex",
                        borderRadius: tokens.radius.sm,
                    }}
                    title="New Space"
                >
                    <Plus size={14} strokeWidth={2} />
                </button>
            </div>

            {spaces.map((space) => {
                const spaceFolders = folders.filter(
                    (f) => f.spaceId === space.id,
                );
                const looseLists = lists.filter(
                    (l) => l.spaceId === space.id && !l.folderId,
                );
                const isExpanded = expandedIds.includes(space.id);

                return (
                    <div key={space.id}>
                        <button
                            onClick={() => toggleExpanded(space.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                width: "100%",
                                padding: "6px 10px",
                                background: "none",
                                border: 0,
                                cursor: "pointer",
                                borderRadius: tokens.radius.md,
                                color: tokens.colors.textPrimary,
                                fontSize: tokens.typography.fontSize.sm,
                                fontWeight: 600,
                            }}
                            onMouseEnter={(e) =>
                                (e.currentTarget.style.background =
                                    tokens.colors.bgHover)
                            }
                            onMouseLeave={(e) =>
                                (e.currentTarget.style.background = "transparent")
                            }
                        >
                            <ChevronRight
                                size={14}
                                strokeWidth={2}
                                style={{
                                    transition: "transform var(--transition-base)",
                                    transform: isExpanded
                                        ? "rotate(90deg)"
                                        : "rotate(0deg)",
                                    color: tokens.colors.textMuted,
                                }}
                            />
                            <span
                                style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: tokens.radius.sm,
                                    background: `${space.color}1A`,
                                    color: space.color,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <DynamicIcon
                                    name={space.icon}
                                    size={12}
                                    strokeWidth={2}
                                />
                            </span>
                            <span
                                style={{
                                    flex: 1,
                                    textAlign: "left",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {space.name}
                            </span>
                        </button>

                        {isExpanded && (
                            <div style={{ paddingLeft: 14 }}>
                                {spaceFolders.map((folder) => {
                                    const isFolderOpen = expandedIds.includes(
                                        folder.id,
                                    );
                                    const folderLists = lists.filter(
                                        (l) => l.folderId === folder.id,
                                    );
                                    return (
                                        <div key={folder.id}>
                                            <button
                                                onClick={() =>
                                                    toggleExpanded(folder.id)
                                                }
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 4,
                                                    width: "100%",
                                                    padding: "5px 10px",
                                                    background: "none",
                                                    border: 0,
                                                    cursor: "pointer",
                                                    borderRadius: tokens.radius.md,
                                                    color: tokens.colors.textSecondary,
                                                    fontSize: tokens.typography.fontSize.sm,
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
                                                <ChevronRight
                                                    size={12}
                                                    strokeWidth={2}
                                                    style={{
                                                        transition:
                                                            "transform var(--transition-base)",
                                                        transform:
                                                            isFolderOpen
                                                                ? "rotate(90deg)"
                                                                : "rotate(0deg)",
                                                        color: tokens.colors
                                                            .textMuted,
                                                        flexShrink: 0,
                                                    }}
                                                />
                                                <DynamicIcon
                                                    name="Folder"
                                                    size={14}
                                                    strokeWidth={1.75}
                                                    color={tokens.colors.textMuted}
                                                />
                                                <span
                                                    style={{
                                                        flex: 1,
                                                        textAlign: "left",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}
                                                >
                                                    {folder.name}
                                                </span>
                                            </button>

                                            {isFolderOpen && (
                                                <div style={{ paddingLeft: 18 }}>
                                                    {folderLists.map((list) => (
                                                        <ListRow
                                                            key={list.id}
                                                            list={list}
                                                            isActive={location.pathname.startsWith(
                                                                `/s/${space.id}/l/${list.id}`,
                                                            )}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {looseLists.map((list) => (
                                    <ListRow
                                        key={list.id}
                                        list={list}
                                        isActive={location.pathname.startsWith(
                                            `/s/${space.id}/l/${list.id}`,
                                        )}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

const ListRow = ({
    list,
    isActive,
}: {
    list: { id: string; spaceId: string; name: string; icon?: string; color?: string };
    isActive: boolean;
}) => {
    const navigate = useNavigate();
    return (
        <button
            onClick={() => navigate(`/s/${list.spaceId}/l/${list.id}`)}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "5px 10px",
                background: isActive ? tokens.colors.primarySubtle : "none",
                border: 0,
                cursor: "pointer",
                borderRadius: tokens.radius.md,
                color: isActive
                    ? tokens.colors.primary
                    : tokens.colors.textSecondary,
                fontSize: tokens.typography.fontSize.sm,
                fontWeight: isActive ? 600 : 400,
                textAlign: "left",
            }}
            onMouseEnter={(e) => {
                if (!isActive)
                    e.currentTarget.style.background = tokens.colors.bgHover;
            }}
            onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
            }}
        >
            <span
                style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: list.color ?? tokens.colors.textMuted,
                    flexShrink: 0,
                }}
            />
            <span
                style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                {list.name}
            </span>
        </button>
    );
};
