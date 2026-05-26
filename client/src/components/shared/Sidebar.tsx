import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, ChevronsRight, Star } from "lucide-react";
import {
    BarChart3,
    Bell,
    Home,
    Inbox,
    Search,
    Settings,
    StickyNote,
    Clock,
    ChevronDown,
    Zap,
    Library,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useUiStore } from "../../stores/ui";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";
import { Logo } from "../ui/Logo";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarSpaceTree } from "./SidebarSpaceTree";

export const Sidebar = () => {
    const { sidebarCollapsed, toggleSidebar } = useUiStore();
    const user = useAuthStore((s) => s.user);
    const { data: workspace } = useQuery({
        queryKey: ["workspace"],
        queryFn: () => mockApi.workspace.get(),
    });
    const { data: unreadCount = 0 } = useQuery({
        queryKey: ["notifications", "unread-count", user?.id],
        queryFn: () => (user ? mockApi.notifications.unreadCount(user.id) : 0),
        enabled: !!user,
    });

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
                        <button
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
                        >
                            <ChevronsLeft size={16} strokeWidth={1.75} />
                        </button>
                    </>
                )}
            </div>

            {/* Scrollable middle */}
            <div
                style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: sidebarCollapsed
                        ? `${tokens.spacing[2]}px 0`
                        : `${tokens.spacing[2]}px ${tokens.spacing[2]}px`,
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
                        <SidebarNavItem
                            to="/dashboards"
                            icon={<BarChart3 size={15} strokeWidth={1.75} />}
                            label="Dashboards"
                        />
                        <SidebarNavItem
                            to="/automations"
                            icon={<Zap size={15} strokeWidth={1.75} />}
                            label="Automations"
                        />
                        <SidebarNavItem
                            to="/templates"
                            icon={<Library size={15} strokeWidth={1.75} />}
                            label="Templates"
                        />

                        {/* Favorites section */}
                        <SectionHeader title="Favorites" icon={<Star size={11} />} />
                        <div
                            style={{
                                padding: "4px 10px 8px",
                                fontSize: tokens.typography.fontSize.xs,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Star a list, doc, or dashboard to pin it here.
                        </div>

                        {/* Spaces tree */}
                        <SidebarSpaceTree collapsed={false} />
                    </>
                )}
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
                            to="/notepad"
                            icon={<StickyNote size={16} strokeWidth={1.75} />}
                            label="Notepad"
                            collapsed
                        />
                        <SidebarNavItem
                            to="/reminders"
                            icon={<Clock size={16} strokeWidth={1.75} />}
                            label="Reminders"
                            collapsed
                        />
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
                        >
                            <ChevronsRight size={16} strokeWidth={1.75} />
                        </button>
                    </>
                ) : (
                    <>
                        <SidebarNavItem
                            to="/notepad"
                            icon={<StickyNote size={15} strokeWidth={1.75} />}
                            label="Notepad"
                        />
                        <SidebarNavItem
                            to="/reminders"
                            icon={<Clock size={15} strokeWidth={1.75} />}
                            label="Reminders"
                        />
                        <SidebarNavItem
                            to="/settings"
                            icon={<Settings size={15} strokeWidth={1.75} />}
                            label="Settings"
                        />
                    </>
                )}
            </div>
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
        <SidebarNavItem
            to="/dashboards"
            icon={<BarChart3 size={16} strokeWidth={1.75} />}
            label="Dashboards"
            collapsed
        />
        <SidebarNavItem
            to="/automations"
            icon={<Zap size={16} strokeWidth={1.75} />}
            label="Automations"
            collapsed
        />
        <SidebarNavItem
            to="/templates"
            icon={<Library size={16} strokeWidth={1.75} />}
            label="Templates"
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
