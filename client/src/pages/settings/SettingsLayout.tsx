import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
    User,
    Settings as SettingsIcon,
    Users,
    Network,
    SquareDashed,
    Tag as TagIcon,
    Hexagon,
    Sparkles,
    Download,
    LayoutTemplate,
    ShieldCheck,
} from "lucide-react";
import { usePermissions } from "../../hooks/usePermissions";
import { tokens } from "../../theme";

type NavItem = {
    to: string;
    label: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    /**
     * Permission required to see this item (RBAC P28). Omitted = everyone.
     * Hiding a link is a courtesy — the route guard and the API both refuse
     * the page regardless, so this only stops people walking into a wall.
     */
    permission?: string;
};

type NavGroup = {
    title: string;
    items: NavItem[];
};

const NAV: NavGroup[] = [
    {
        title: "My account",
        items: [{ to: "/settings/profile", label: "Profile", icon: User }],
    },
    {
        title: "Workspace",
        items: [
            {
                to: "/settings/workspace",
                label: "General",
                icon: SettingsIcon,
                permission: "workspace.settings",
            },
            {
                to: "/settings/members",
                label: "Members",
                icon: Users,
                permission: "member.view",
            },
            {
                to: "/settings/teams",
                label: "Teams",
                icon: Network,
                permission: "member.view",
            },
            {
                to: "/settings/roles",
                label: "Roles & permissions",
                icon: ShieldCheck,
                permission: "role.manage",
            },
        ],
    },
    {
        title: "Catalog",
        items: [
            {
                to: "/settings/task-types",
                label: "Task types",
                icon: Hexagon,
                permission: "catalog.task_types",
            },
            {
                to: "/settings/tags",
                label: "Tags",
                icon: TagIcon,
                permission: "catalog.tags",
            },
            {
                to: "/settings/statuses",
                label: "Statuses",
                icon: SquareDashed,
                permission: "status.manage",
            },
            {
                to: "/settings/custom-fields",
                label: "Custom fields",
                icon: Sparkles,
                permission: "catalog.custom_fields",
            },
            {
                to: "/settings/templates",
                label: "Templates",
                icon: LayoutTemplate,
                permission: "catalog.templates",
            },
        ],
    },
    {
        title: "Data",
        items: [
            {
                to: "/settings/import-export",
                label: "Import / Export",
                icon: Download,
            },
        ],
    },
];

export const SettingsLayout = () => {
    const location = useLocation();
    const isMobile = useIsMobile();
    const { holds, ready } = usePermissions();
    // Until the permission set lands, show only the ungated items rather than
    // flashing links that then vanish.
    const visible = NAV.map((g) => ({
        ...g,
        items: g.items.filter((i) => !i.permission || (ready && holds(i.permission))),
    })).filter((g) => g.items.length > 0);
    return (
        <div
            style={
                isMobile
                    ? { display: "block", background: tokens.colors.bgPage }
                    : {
                          display: "grid",
                          gridTemplateColumns: "260px 1fr",
                          minHeight: "calc(100vh - 48px)",
                          background: tokens.colors.bgPage,
                      }
            }
        >
            <aside
                style={
                    isMobile
                        ? {
                              background: tokens.colors.bgSurface,
                              borderBottom: `1px solid ${tokens.colors.border}`,
                              padding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px`,
                              display: "flex",
                              gap: tokens.spacing[2],
                              overflowX: "auto",
                              overflowY: "hidden",
                              position: "sticky",
                              top: 0,
                              zIndex: 1,
                          }
                        : {
                              background: tokens.colors.bgSurface,
                              borderRight: `1px solid ${tokens.colors.border}`,
                              padding: `${tokens.spacing[5]}px ${tokens.spacing[3]}px`,
                              overflow: "auto",
                              position: "sticky",
                              top: 0,
                              height: "calc(100vh - 48px)",
                          }
                }
            >
                {!isMobile && (
                <h2
                    style={{
                        margin: 0,
                        marginBottom: tokens.spacing[4],
                        marginLeft: tokens.spacing[2],
                        fontSize: tokens.typography.fontSize.xl,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                    }}
                >
                    Settings
                </h2>
                )}
                {visible.map((group) => (
                    <div
                        key={group.title}
                        style={
                            isMobile
                                ? { display: "contents" }
                                : { marginBottom: tokens.spacing[4] }
                        }
                    >
                        {!isMobile && (
                        <div
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: tokens.colors.textMuted,
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                padding: `${tokens.spacing[1]}px ${tokens.spacing[2]}px`,
                                marginBottom: 2,
                            }}
                        >
                            {group.title}
                        </div>
                        )}
                        {group.items.map((item) => {
                            const active = location.pathname.startsWith(
                                item.to,
                            );
                            const Icon = item.icon;
                            return (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: isMobile
                                            ? "10px 14px"
                                            : "6px 10px",
                                        flexShrink: isMobile ? 0 : undefined,
                                        whiteSpace: isMobile
                                            ? "nowrap"
                                            : undefined,
                                        borderRadius: tokens.radius.md,
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        textDecoration: "none",
                                        color: active
                                            ? tokens.colors.primary
                                            : tokens.colors.textPrimary,
                                        background: active
                                            ? tokens.colors.primarySubtle
                                            : "transparent",
                                        fontWeight: active ? 600 : 500,
                                        transition:
                                            "background var(--transition-fast)",
                                    }}
                                >
                                    <Icon size={14} strokeWidth={1.75} />
                                    {item.label}
                                </NavLink>
                            );
                        })}
                    </div>
                ))}
            </aside>

            <main
                style={
                    isMobile
                        ? { padding: tokens.spacing[4] }
                        : {
                              padding: tokens.spacing[6],
                              overflow: "auto",
                              maxHeight: "calc(100vh - 48px)",
                          }
                }
            >
                <div style={{ maxWidth: 880, margin: "0 auto" }}>
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default SettingsLayout;
