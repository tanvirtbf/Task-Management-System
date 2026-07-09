import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
    ChevronsLeft,
    ChevronsRight,
    Star,
    Home,
    Inbox,
    Search,
    Settings,
    ChevronDown,
    Users,
    Code,
    Zap,
    Shield,
    LogOut,
    Plus,
    X,
} from "lucide-react";
import { Dropdown, Input, App as AntApp } from "antd";
import { workspaceApi, notificationsApi } from "../../http/api";
import { useUiStore } from "../../stores/ui";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";
import { Logo } from "../ui/Logo";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarSpaceTree } from "./SidebarSpaceTree";
import { SidebarFavorites } from "./SidebarFavorites";
import { CreateSpaceModal } from "./CreateSpaceModal";
import { ReportBugButton } from "./ReportBugButton";

export const Sidebar = () => {
    const navigate = useNavigate();
    const { message } = AntApp.useApp();
    const { sidebarCollapsed, toggleSidebar } = useUiStore();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const [treeSearch, setTreeSearch] = useState("");
    const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
    const { data: workspace } = useQuery({
        queryKey: ["workspace"],
        queryFn: () => workspaceApi.get(),
    });
    const { data: unreadCount = 0 } = useQuery({
        queryKey: ["notifications", "unread-count", user?.id],
        queryFn: () => notificationsApi.unreadCount(),
        enabled: !!user,
        refetchInterval: 60_000,
    });

    const workspaceMenuItems = [
        {
            key: "settings",
            icon: <Settings size={13} strokeWidth={1.75} />,
            label: "Workspace settings",
            onClick: () => navigate("/settings/workspace"),
        },
        {
            key: "members",
            icon: <Users size={13} strokeWidth={1.75} />,
            label: "Members",
            onClick: () => navigate("/settings/members"),
        },
        {
            key: "newSpace",
            icon: <Plus size={13} strokeWidth={1.75} />,
            label: "New space",
            onClick: () => setCreateSpaceOpen(true),
        },
        { type: "divider" as const },
        {
            key: "copyLink",
            label: "Copy workspace link",
            onClick: () => {
                navigator.clipboard
                    .writeText(window.location.origin)
                    .then(() => message.success("Workspace link copied"))
                    .catch(() => message.error("Could not copy"));
            },
        },
        { type: "divider" as const },
        {
            key: "logout",
            icon: <LogOut size={13} strokeWidth={1.75} />,
            label: "Sign out",
            danger: true,
            onClick: () => {
                logout();
                navigate("/login");
            },
        },
    ];

    const width = sidebarCollapsed
        ? tokens.layout.sidebarCollapsedWidth
        : tokens.layout.sidebarWidth;

    return (
        <aside
            style={{
                width,
                flexShrink: 0,
                background: tokens.colors.bgSidebar,
                borderRight: `1px solid ${tokens.colors.border}`,
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                position: "sticky",
                top: 0,
                transition: "width var(--transition-slow)",
                overflow: "hidden",
            }}
        >
            {/* Header — Workspace switcher */}
            <div
                style={{
                    height: tokens.layout.headerHeight,
                    padding: sidebarCollapsed ? "0 8px" : "0 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: sidebarCollapsed
                        ? "center"
                        : "space-between",
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    flexShrink: 0,
                }}
            >
                {sidebarCollapsed ? (
                    <Logo size={26} showWordmark={false} />
                ) : (
                    <>
                        <Dropdown
                            menu={{ items: workspaceMenuItems }}
                            trigger={["click"]}
                            placement="bottomLeft"
                        >
                            <button
                                aria-label="Workspace menu"
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    background: "none",
                                    border: 0,
                                    padding: 4,
                                    borderRadius: tokens.radius.md,
                                    cursor: "pointer",
                                    color: tokens.colors.textPrimary,
                                    fontSize: tokens.typography.fontSize.sm,
                                    fontWeight: 600,
                                    flex: 1,
                                    minWidth: 0,
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
                                <Logo size={22} showWordmark={false} />
                                <span
                                    style={{
                                        flex: 1,
                                        textAlign: "left",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {workspace?.name ?? "Workspace"}
                                </span>
                                <ChevronDown
                                    size={14}
                                    strokeWidth={2}
                                    color={tokens.colors.textMuted}
                                />
                            </button>
                        </Dropdown>
                        <button
                            onClick={toggleSidebar}
                            style={{
                                background: "none",
                                border: 0,
                                padding: 6,
                                borderRadius: tokens.radius.md,
                                cursor: "pointer",
                                color: tokens.colors.textMuted,
                                display: "flex",
                            }}
                            title="Collapse sidebar"
                            aria-label="Collapse sidebar"
                        >
                            <ChevronsLeft size={16} strokeWidth={1.75} />
                        </button>
                    </>
                )}
            </div>

            {/* Scrollable middle. The scroll lives on THIS box (flex:1 +
                minHeight:0 + overflowY:auto). The content sits in an INNER
                flex-column so its items keep their natural height and the area
                SCROLLS when long — instead of the flex children shrinking
                (squishing) to fit, which is what happened before. */}
            <div
                data-testid="sidebar-scroll"
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    padding: sidebarCollapsed
                        ? `${tokens.spacing[2]}px 0`
                        : `${tokens.spacing[2]}px ${tokens.spacing[2]}px`,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                    }}
                >
                {sidebarCollapsed ? (
                    <CollapsedQuickLinks unreadCount={unreadCount} />
                ) : (
                    <>
                        <SidebarNavItem
                            to="/"
                            icon={<Home size={15} strokeWidth={1.75} />}
                            label="Home"
                        />
                        <SidebarNavItem
                            to="/inbox"
                            icon={<Inbox size={15} strokeWidth={1.75} />}
                            label="Inbox"
                            rightSlot={
                                unreadCount > 0 ? (
                                    <UnreadBadge count={unreadCount} />
                                ) : undefined
                            }
                        />
                        <SidebarNavItem
                            to="/search"
                            icon={<Search size={15} strokeWidth={1.75} />}
                            label="Search"
                            rightSlot={<KbdHint k="⌘K" />}
                        />
                        <SectionHeader title="Engineering" icon={<Code size={11} />} />
                        <SidebarNavItem
                            to="/eng"
                            icon={<Code size={15} strokeWidth={1.75} />}
                            label="Eng Home"
                        />
                        <SidebarNavItem
                            to="/eng/sprint"
                            icon={<Zap size={15} strokeWidth={1.75} />}
                            label="Sprint Board"
                        />
                        <SidebarNavItem
                            to="/eng/on-call"
                            icon={<Shield size={15} strokeWidth={1.75} />}
                            label="On-call rotation"
                        />
                        <div style={{ padding: "4px 6px" }}>
                            <ReportBugButton />
                        </div>
                        {/* Favorites section */}
                        <SectionHeader title="Favorites" icon={<Star size={11} />} />
                        <SidebarFavorites />

                        {/* Tree search */}
                        <div
                            style={{
                                padding: "8px 4px 4px",
                            }}
                        >
                            <Input
                                size="small"
                                placeholder="Filter spaces & lists..."
                                value={treeSearch}
                                onChange={(e) => setTreeSearch(e.target.value)}
                                prefix={
                                    <Search
                                        size={12}
                                        strokeWidth={1.75}
                                        color={tokens.colors.textMuted}
                                    />
                                }
                                suffix={
                                    treeSearch ? (
                                        <button
                                            onClick={() => setTreeSearch("")}
                                            aria-label="Clear filter"
                                            style={{
                                                background: "transparent",
                                                border: 0,
                                                cursor: "pointer",
                                                padding: 0,
                                                display: "inline-flex",
                                                color: tokens.colors.textMuted,
                                            }}
                                        >
                                            <X size={11} strokeWidth={1.75} />
                                        </button>
                                    ) : null
                                }
                                style={{
                                    background: tokens.colors.bgSurface,
                                }}
                            />
                        </div>

                        {/* Spaces tree */}
                        <SidebarSpaceTree
                            collapsed={false}
                            searchQuery={treeSearch}
                        />
                    </>
                )}
                </div>
            </div>

            {/* Bottom pinned */}
            <div
                style={{
                    borderTop: `1px solid ${tokens.colors.border}`,
                    padding: sidebarCollapsed
                        ? `${tokens.spacing[2]}px 0`
                        : `${tokens.spacing[2]}px`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    flexShrink: 0,
                }}
            >
                {sidebarCollapsed ? (
                    <>
                        <SidebarNavItem
                            to="/settings"
                            icon={<Settings size={16} strokeWidth={1.75} />}
                            label="Settings"
                            collapsed
                        />
                        <button
                            onClick={toggleSidebar}
                            style={{
                                width: 40,
                                height: 32,
                                margin: "4px auto 0",
                                borderRadius: tokens.radius.md,
                                background: "none",
                                border: 0,
                                cursor: "pointer",
                                color: tokens.colors.textMuted,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                            title="Expand sidebar"
                            aria-label="Expand sidebar"
                        >
                            <ChevronsRight size={16} strokeWidth={1.75} />
                        </button>
                    </>
                ) : (
                    <SidebarNavItem
                        to="/settings"
                        icon={<Settings size={15} strokeWidth={1.75} />}
                        label="Settings"
                    />
                )}
            </div>
            {createSpaceOpen && (
                <CreateSpaceModal onClose={() => setCreateSpaceOpen(false)} />
            )}
        </aside>
    );
};

const CollapsedQuickLinks = ({ unreadCount }: { unreadCount: number }) => (
    <div
        style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            alignItems: "center",
            padding: "4px 0",
        }}
    >
        <SidebarNavItem
            to="/"
            icon={<Home size={16} strokeWidth={1.75} />}
            label="Home"
            collapsed
        />
        <div style={{ position: "relative" }}>
            <SidebarNavItem
                to="/inbox"
                icon={<Inbox size={16} strokeWidth={1.75} />}
                label="Inbox"
                collapsed
            />
            {unreadCount > 0 && (
                <span
                    style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        background: tokens.colors.danger,
                        color: "#fff",
                        fontSize: 9,
                        fontWeight: 600,
                        minWidth: 14,
                        height: 14,
                        borderRadius: 7,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 4px",
                    }}
                >
                    {unreadCount}
                </span>
            )}
        </div>
        <SidebarNavItem
            to="/search"
            icon={<Search size={16} strokeWidth={1.75} />}
            label="Search"
            collapsed
        />
        <div
            style={{
                width: 24,
                height: 1,
                background: tokens.colors.border,
                margin: "6px 0",
            }}
        />
    </div>
);

const SectionHeader = ({
    title,
    icon,
}: {
    title: string;
    icon?: React.ReactNode;
}) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "12px 10px 4px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: tokens.colors.textMuted,
            textTransform: "uppercase",
        }}
    >
        {icon}
        <span>{title}</span>
    </div>
);

const UnreadBadge = ({ count }: { count: number }) => (
    <span
        style={{
            background: tokens.colors.danger,
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            padding: "0 5px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: tokens.typography.fontFamilyMono,
        }}
    >
        {count}
    </span>
);

const KbdHint = ({ k }: { k: string }) => (
    <kbd
        style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 10,
            background: tokens.colors.bgMuted,
            color: tokens.colors.textMuted,
            padding: "1px 5px",
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: 4,
        }}
    >
        {k}
    </kbd>
);
