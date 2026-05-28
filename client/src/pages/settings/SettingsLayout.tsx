import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
    User,
    Settings as SettingsIcon,
    Users,
    SquareDashed,
    Tag as TagIcon,
    Hexagon,
    Sparkles,
    Download,
    LayoutTemplate,
} from "lucide-react";
import { tokens } from "../../theme";

type NavItem = {
    to: string;
    label: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
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
            },
            { to: "/settings/members", label: "Members", icon: Users },
        ],
    },
    {
        title: "Catalog",
        items: [
            {
                to: "/settings/task-types",
                label: "Task types",
                icon: Hexagon,
            },
            { to: "/settings/tags", label: "Tags", icon: TagIcon },
            {
                to: "/settings/statuses",
                label: "Statuses",
                icon: SquareDashed,
            },
            {
                to: "/settings/custom-fields",
                label: "Custom fields",
                icon: Sparkles,
            },
            {
                to: "/settings/templates",
                label: "Templates",
                icon: LayoutTemplate,
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
    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "260px 1fr",
                minHeight: "calc(100vh - 48px)",
                background: tokens.colors.bgPage,
            }}
        >
            <aside
                style={{
                    background: tokens.colors.bgSurface,
                    borderRight: `1px solid ${tokens.colors.border}`,
                    padding: `${tokens.spacing[5]}px ${tokens.spacing[3]}px`,
                    overflow: "auto",
                    position: "sticky",
                    top: 0,
                    height: "calc(100vh - 48px)",
                }}
            >
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
                {NAV.map((group) => (
                    <div
                        key={group.title}
                        style={{ marginBottom: tokens.spacing[4] }}
                    >
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
                                        padding: "6px 10px",
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
                style={{
                    padding: tokens.spacing[6],
                    overflow: "auto",
                    maxHeight: "calc(100vh - 48px)",
                }}
            >
                <div style={{ maxWidth: 880, margin: "0 auto" }}>
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default SettingsLayout;
