import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, Star, MoreHorizontal } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tooltip, Dropdown, Modal, App as AntApp } from "antd";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { useUiStore } from "../../stores/ui";
import { tokens } from "../../theme";
import { DynamicIcon } from "./DynamicIcon";
import { CreateSpaceModal } from "./CreateSpaceModal";
import { CreateListModal } from "./CreateListModal";
import { RenameInline } from "./RenameInline";
import type { List, Space } from "../../types";

interface Props {
    collapsed: boolean;
    /** Lowercase search query that filters spaces/lists by name. */
    searchQuery?: string;
}

export const SidebarSpaceTree = ({ collapsed, searchQuery = "" }: Props) => {
    const navigate = useNavigate();
    const location = useLocation();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const { expandedIds, toggleExpanded, setExpanded } = useUiStore();
    const favoriteIds = useUiStore((s) => s.favoriteIds);
    const toggleFavorite = useUiStore((s) => s.toggleFavorite);

    const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
    const [createListInSpace, setCreateListInSpace] = useState<string | null>(
        null,
    );
    const [renamingSpace, setRenamingSpace] = useState<string | null>(null);
    const [renamingList, setRenamingList] = useState<string | null>(null);

    const currentUser = useAuthStore((s) => s.user);
    const { data: allSpaces = [] } = useQuery({
        queryKey: ["spaces"],
        queryFn: () => mockApi.spaces.list(),
    });
    /** Members and guests only see public spaces. */
    const spaces = allSpaces.filter((s) => {
        if (!s.isPrivate) return true;
        if (!currentUser) return false;
        return (
            currentUser.role === "owner" || currentUser.role === "admin"
        );
    });
    const { data: folders = [] } = useQuery({
        queryKey: ["folders"],
        queryFn: () => mockApi.folders.list(),
    });
    const { data: lists = [] } = useQuery({
        queryKey: ["lists"],
        queryFn: () => mockApi.lists.listAll(),
    });

    const renameSpace = useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) =>
            mockApi.spaces.update(id, { name }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["spaces"] });
            setRenamingSpace(null);
        },
    });
    const archiveSpace = useMutation({
        mutationFn: (id: string) => mockApi.spaces.archive(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["spaces"] });
            message.success("Space archived");
        },
    });

    const renameList = useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) =>
            mockApi.lists.update(id, { name }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["lists"] });
            setRenamingList(null);
        },
    });
    const archiveList = useMutation({
        mutationFn: (id: string) => mockApi.lists.archive(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["lists"] });
            message.success("List archived");
        },
    });
    const deleteList = useMutation({
        mutationFn: (id: string) => mockApi.lists.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["lists"] });
            message.success("List deleted");
        },
    });

    const q = searchQuery.trim().toLowerCase();

    const filteredSpaces = useMemo(() => {
        if (!q) return spaces;
        return spaces.filter((sp) => {
            if (sp.name.toLowerCase().includes(q)) return true;
            return lists.some(
                (l) => l.spaceId === sp.id && l.name.toLowerCase().includes(q),
            );
        });
    }, [spaces, lists, q]);

    const effectivelyExpanded = (id: string) =>
        q ? true : expandedIds.includes(id);

    const listsInSpace = (spaceId: string): List[] => {
        const all = lists.filter((l) => l.spaceId === spaceId);
        if (!q) return all;
        const spaceMatches = spaces.find(
            (s) => s.id === spaceId && s.name.toLowerCase().includes(q),
        );
        if (spaceMatches) return all;
        return all.filter((l) => l.name.toLowerCase().includes(q));
    };

    const handleCopyLink = (path: string) => {
        const url = `${window.location.origin}${path}`;
        navigator.clipboard
            .writeText(url)
            .then(() => message.success("Link copied"))
            .catch(() => message.error("Could not copy"));
    };

    const confirmArchiveSpace = (id: string, name: string) =>
        Modal.confirm({
            title: `Archive “${name}”?`,
            content: "Archived spaces are hidden but their data is kept.",
            okType: "danger",
            onOk: () => archiveSpace.mutate(id),
        });

    const confirmArchiveList = (id: string, name: string) =>
        Modal.confirm({
            title: `Archive “${name}”?`,
            content: "Tasks in this list will be hidden.",
            okType: "danger",
            onOk: () => archiveList.mutate(id),
        });

    const confirmDeleteList = (id: string, name: string) =>
        Modal.confirm({
            title: `Permanently delete “${name}”?`,
            content: "This action cannot be undone.",
            okType: "danger",
            onOk: () => deleteList.mutate(id),
        });

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
                    <Tooltip
                        key={space.id}
                        title={space.name}
                        placement="right"
                    >
                        <button
                            onClick={() => navigate(`/s/${space.id}`)}
                            aria-label={space.name}
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
                <Tooltip title="New space">
                    <button
                        onClick={() => setCreateSpaceOpen(true)}
                        aria-label="New space"
                        style={{
                            background: "none",
                            border: 0,
                            color: tokens.colors.textMuted,
                            cursor: "pointer",
                            padding: 2,
                            display: "flex",
                            borderRadius: tokens.radius.sm,
                        }}
                    >
                        <Plus size={14} strokeWidth={2} />
                    </button>
                </Tooltip>
            </div>

            {filteredSpaces.length === 0 && q && (
                <div
                    style={{
                        padding: "8px 12px",
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                        fontStyle: "italic",
                    }}
                >
                    No spaces match.
                </div>
            )}

            {filteredSpaces.map((space) => {
                const spaceFolders = folders.filter(
                    (f) => f.spaceId === space.id,
                );
                const looseLists = listsInSpace(space.id).filter(
                    (l) => !l.folderId,
                );
                const isExpanded = effectivelyExpanded(space.id);

                return (
                    <SpaceRow
                        key={space.id}
                        space={space}
                        isExpanded={isExpanded}
                        renaming={renamingSpace === space.id}
                        onToggle={() => toggleExpanded(space.id)}
                        onRename={(name) =>
                            renameSpace.mutate({ id: space.id, name })
                        }
                        onCancelRename={() => setRenamingSpace(null)}
                        onContextRename={() => setRenamingSpace(space.id)}
                        onCreateList={() => {
                            setExpanded(space.id, true);
                            setCreateListInSpace(space.id);
                        }}
                        onArchive={() =>
                            confirmArchiveSpace(space.id, space.name)
                        }
                        onCopyLink={() => handleCopyLink(`/s/${space.id}`)}
                    >
                        {spaceFolders.map((folder) => {
                            const isFolderOpen = effectivelyExpanded(folder.id);
                            const folderLists = listsInSpace(space.id).filter(
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
                                            fontSize:
                                                tokens.typography.fontSize.sm,
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
                                                transform: isFolderOpen
                                                    ? "rotate(90deg)"
                                                    : "rotate(0deg)",
                                                color: tokens.colors.textMuted,
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
                                                    isFavorite={favoriteIds.includes(
                                                        list.id,
                                                    )}
                                                    renaming={
                                                        renamingList ===
                                                        list.id
                                                    }
                                                    onToggleFavorite={() =>
                                                        toggleFavorite(list.id)
                                                    }
                                                    onContextRename={() =>
                                                        setRenamingList(list.id)
                                                    }
                                                    onRename={(name) =>
                                                        renameList.mutate({
                                                            id: list.id,
                                                            name,
                                                        })
                                                    }
                                                    onCancelRename={() =>
                                                        setRenamingList(null)
                                                    }
                                                    onArchive={() =>
                                                        confirmArchiveList(
                                                            list.id,
                                                            list.name,
                                                        )
                                                    }
                                                    onDelete={() =>
                                                        confirmDeleteList(
                                                            list.id,
                                                            list.name,
                                                        )
                                                    }
                                                    onCopyLink={() =>
                                                        handleCopyLink(
                                                            `/s/${space.id}/l/${list.id}`,
                                                        )
                                                    }
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
                                isFavorite={favoriteIds.includes(list.id)}
                                renaming={renamingList === list.id}
                                onToggleFavorite={() =>
                                    toggleFavorite(list.id)
                                }
                                onContextRename={() =>
                                    setRenamingList(list.id)
                                }
                                onRename={(name) =>
                                    renameList.mutate({
                                        id: list.id,
                                        name,
                                    })
                                }
                                onCancelRename={() => setRenamingList(null)}
                                onArchive={() =>
                                    confirmArchiveList(list.id, list.name)
                                }
                                onDelete={() =>
                                    confirmDeleteList(list.id, list.name)
                                }
                                onCopyLink={() =>
                                    handleCopyLink(
                                        `/s/${space.id}/l/${list.id}`,
                                    )
                                }
                            />
                        ))}
                    </SpaceRow>
                );
            })}

            {createSpaceOpen && (
                <CreateSpaceModal onClose={() => setCreateSpaceOpen(false)} />
            )}
            {createListInSpace && (
                <CreateListModal
                    defaultSpaceId={createListInSpace}
                    onClose={() => setCreateListInSpace(null)}
                />
            )}
        </div>
    );
};

const SpaceRow = ({
    space,
    isExpanded,
    renaming,
    onToggle,
    onRename,
    onCancelRename,
    onContextRename,
    onCreateList,
    onArchive,
    onCopyLink,
    children,
}: {
    space: Space;
    isExpanded: boolean;
    renaming: boolean;
    onToggle: () => void;
    onRename: (name: string) => void;
    onCancelRename: () => void;
    onContextRename: () => void;
    onCreateList: () => void;
    onArchive: () => void;
    onCopyLink: () => void;
    children: React.ReactNode;
}) => {
    const menuItems = [
        { key: "rename", label: "Rename", onClick: onContextRename },
        { key: "newList", label: "New list", onClick: onCreateList },
        { key: "copy", label: "Copy link", onClick: onCopyLink },
        { type: "divider" as const },
        {
            key: "archive",
            label: "Archive space",
            danger: true,
            onClick: onArchive,
        },
    ];

    return (
        <div>
            <Dropdown menu={{ items: menuItems }} trigger={["contextMenu"]}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0,
                    }}
                >
                    <button
                        onClick={renaming ? undefined : onToggle}
                        disabled={renaming}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            flex: 1,
                            padding: "6px 10px",
                            background: "none",
                            border: 0,
                            cursor: renaming ? "default" : "pointer",
                            borderRadius: tokens.radius.md,
                            color: tokens.colors.textPrimary,
                            fontSize: tokens.typography.fontSize.sm,
                            fontWeight: 600,
                            minWidth: 0,
                        }}
                        onMouseEnter={(e) => {
                            if (!renaming)
                                e.currentTarget.style.background =
                                    tokens.colors.bgHover;
                        }}
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
                                flexShrink: 0,
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
                        {renaming ? (
                            <RenameInline
                                initial={space.name}
                                onSave={onRename}
                                onCancel={onCancelRename}
                            />
                        ) : (
                            <span
                                style={{
                                    flex: 1,
                                    textAlign: "left",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {space.name}
                            </span>
                        )}
                    </button>
                    {!renaming && (
                        <>
                            <Tooltip title="New list in space">
                                <button
                                    onClick={onCreateList}
                                    aria-label="New list"
                                    style={{
                                        background: "none",
                                        border: 0,
                                        cursor: "pointer",
                                        padding: 4,
                                        color: tokens.colors.textMuted,
                                        display: "inline-flex",
                                        borderRadius: tokens.radius.sm,
                                    }}
                                >
                                    <Plus size={12} strokeWidth={2} />
                                </button>
                            </Tooltip>
                            <Dropdown
                                menu={{ items: menuItems }}
                                trigger={["click"]}
                                placement="bottomRight"
                            >
                                <button
                                    aria-label="Space actions"
                                    style={{
                                        background: "none",
                                        border: 0,
                                        cursor: "pointer",
                                        padding: 4,
                                        color: tokens.colors.textMuted,
                                        display: "inline-flex",
                                        borderRadius: tokens.radius.sm,
                                    }}
                                >
                                    <MoreHorizontal
                                        size={13}
                                        strokeWidth={2}
                                    />
                                </button>
                            </Dropdown>
                        </>
                    )}
                </div>
            </Dropdown>
            {isExpanded && <div style={{ paddingLeft: 14 }}>{children}</div>}
        </div>
    );
};

const ListRow = ({
    list,
    isActive,
    isFavorite,
    renaming,
    onToggleFavorite,
    onContextRename,
    onRename,
    onCancelRename,
    onArchive,
    onDelete,
    onCopyLink,
}: {
    list: List;
    isActive: boolean;
    isFavorite: boolean;
    renaming: boolean;
    onToggleFavorite: () => void;
    onContextRename: () => void;
    onRename: (name: string) => void;
    onCancelRename: () => void;
    onArchive: () => void;
    onDelete: () => void;
    onCopyLink: () => void;
}) => {
    const navigate = useNavigate();
    const menuItems = [
        { key: "rename", label: "Rename", onClick: onContextRename },
        { key: "copy", label: "Copy link", onClick: onCopyLink },
        {
            key: "fav",
            label: isFavorite
                ? "Remove from favorites"
                : "Add to favorites",
            onClick: onToggleFavorite,
        },
        { type: "divider" as const },
        { key: "archive", label: "Archive list", onClick: onArchive },
        {
            key: "delete",
            label: "Delete list",
            danger: true,
            onClick: onDelete,
        },
    ];

    return (
        <Dropdown menu={{ items: menuItems }} trigger={["contextMenu"]}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: 0,
                    background: isActive
                        ? tokens.colors.primarySubtle
                        : "transparent",
                    borderRadius: tokens.radius.md,
                }}
                onMouseEnter={(e) => {
                    if (!isActive)
                        e.currentTarget.style.background =
                            tokens.colors.bgHover;
                }}
                onMouseLeave={(e) => {
                    if (!isActive)
                        e.currentTarget.style.background = "transparent";
                }}
            >
                <button
                    onClick={
                        renaming
                            ? undefined
                            : () =>
                                  navigate(`/s/${list.spaceId}/l/${list.id}`)
                    }
                    disabled={renaming}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flex: 1,
                        padding: "5px 10px",
                        background: "none",
                        border: 0,
                        cursor: renaming ? "default" : "pointer",
                        color: isActive
                            ? tokens.colors.primary
                            : tokens.colors.textSecondary,
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: isActive ? 600 : 400,
                        textAlign: "left",
                        overflow: "hidden",
                        minWidth: 0,
                    }}
                >
                    <span
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background:
                                list.color ?? tokens.colors.textMuted,
                            flexShrink: 0,
                        }}
                    />
                    {renaming ? (
                        <RenameInline
                            initial={list.name}
                            onSave={onRename}
                            onCancel={onCancelRename}
                        />
                    ) : (
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
                    )}
                </button>
                {!renaming && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite();
                        }}
                        aria-label={
                            isFavorite ? "Unfavorite list" : "Favorite list"
                        }
                        title={isFavorite ? "Unfavorite" : "Add to favorites"}
                        style={{
                            background: "none",
                            border: 0,
                            cursor: "pointer",
                            color: isFavorite
                                ? tokens.colors.warning
                                : tokens.colors.textMuted,
                            padding: 4,
                            display: "inline-flex",
                            opacity: isFavorite ? 1 : 0.6,
                        }}
                    >
                        <Star
                            size={11}
                            strokeWidth={1.75}
                            fill={
                                isFavorite ? tokens.colors.warning : "none"
                            }
                        />
                    </button>
                )}
            </div>
        </Dropdown>
    );
};
