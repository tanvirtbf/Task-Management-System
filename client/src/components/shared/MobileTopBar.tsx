import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Dropdown } from "antd";
import {
    ChevronLeft,
    Search,
    Settings,
    ShieldAlert,
    Building2,
    BarChart3,
    Code,
    LogOut,
    Bug,
} from "lucide-react";
import { spacesApi } from "../../http/api";
import { useAuthStore } from "../../stores/auth";
import { usePermissions } from "../../hooks/usePermissions";
import { Breadcrumb } from "./Breadcrumb";
import { ReportBugButton } from "./ReportBugButton";
import { Avatar } from "../ui/Avatar";
import { tokens } from "../../theme";

/**
 * P3 of MOBILE_REBUILD_PLAN.md — the phone's top bar.
 *
 * Deliberately thin: a back affordance, where you are, search, and the avatar.
 * Everything weekly-or-rarer lives behind the avatar (D4) rather than in a
 * "More" tab — SLA, Department, Reports, Engineering and Settings are all
 * places people go looking for under their own name anyway.
 *
 * The back button matters more than it looks: an iPhone has no hardware back,
 * and the app's only "up" affordance is a breadcrumb that renders on two route
 * families and returns null everywhere else. Task detail already pushes history
 * (so Android Back closes the drawer); this gives everyone else the same way out.
 */
export const MOBILE_TOPBAR_HEIGHT = 52;

/** Routes that are a tab root — nothing to go "back" from. */
const ROOTS = new Set(["/", "/inbox", "/spaces"]);

const TITLES: Record<string, string> = {
    "/": "Home",
    "/inbox": "Inbox",
    "/search": "Search",
    "/spaces": "Spaces",
    "/sla": "SLA breaches",
    "/dept": "Department",
    "/reports": "Reports",
    "/eng": "Engineering",
    "/eng/sprint": "Sprint board",
    "/eng/on-call": "On-call",
    "/forms": "Forms",
};

export const MobileTopBar = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const { holds } = usePermissions();
    const [bugOpen, setBugOpen] = useState(false);

    const { data: spaces = [] } = useQuery({
        queryKey: ["spaces"],
        queryFn: () => spacesApi.list(),
        enabled: !!user,
    });

    // Same gates the sidebar uses, so a phone never offers a door that leads to
    // a Forbidden page.
    const canSeeDept =
        user?.role === "owner" ||
        user?.role === "admin" ||
        spaces.some((s) => !s.archivedAt && s.headUserId === user?.id);
    const canSeeEngineering =
        holds("sprint.manage") ||
        holds("sprint.assign_tasks") ||
        holds("oncall.manage") ||
        holds("postmortem.manage");

    const title = useMemo(() => {
        if (TITLES[pathname]) return TITLES[pathname];
        if (pathname.startsWith("/settings")) return "Settings";
        if (pathname.startsWith("/reports/")) return "Report";
        return "";
    }, [pathname]);

    const showBack = !ROOTS.has(pathname);

    const menuItems = [
        { key: "sla", label: "SLA breaches", icon: <ShieldAlert size={15} />, onClick: () => navigate("/sla") },
        canSeeDept && {
            key: "dept",
            label: "Department",
            icon: <Building2 size={15} />,
            onClick: () => navigate("/dept"),
        },
        canSeeDept && {
            key: "reports",
            label: "Reports",
            icon: <BarChart3 size={15} />,
            onClick: () => navigate("/reports"),
        },
        canSeeEngineering && {
            key: "eng",
            label: "Engineering",
            icon: <Code size={15} />,
            onClick: () => navigate("/eng"),
        },
        { type: "divider" as const },
        // The only trigger used to live in the sidebar, which a phone never
        // renders — and warehouse and CS staff are exactly who file bugs.
        { key: "bug", label: "Report a bug", icon: <Bug size={15} />, onClick: () => setBugOpen(true) },
        { key: "settings", label: "Settings", icon: <Settings size={15} />, onClick: () => navigate("/settings/profile") },
        {
            key: "logout",
            label: "Sign out",
            icon: <LogOut size={15} />,
            danger: true,
            onClick: async () => {
                await logout();
                navigate("/login");
            },
        },
    ].filter(Boolean) as NonNullable<
        React.ComponentProps<typeof Dropdown>["menu"]
    >["items"];

    return (
        <header
            style={{
                height: `calc(${MOBILE_TOPBAR_HEIGHT}px + var(--safe-top, 0px))`,
                paddingTop: "var(--safe-top, 0px)",
                background: tokens.colors.bgSurface,
                borderBottom: `1px solid ${tokens.colors.border}`,
                display: "flex",
                alignItems: "center",
                gap: tokens.spacing[2],
                padding: `0 ${tokens.spacing[2]}px`,
                position: "sticky",
                top: 0,
                zIndex: tokens.zIndex.sticky,
            }}
        >
            {showBack ? (
                <button
                    onClick={() => navigate(-1)}
                    aria-label="Back"
                    style={{
                        width: 44,
                        height: 44,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: tokens.colors.textPrimary,
                        flexShrink: 0,
                    }}
                >
                    <ChevronLeft size={22} strokeWidth={2} />
                </button>
            ) : (
                <span style={{ width: tokens.spacing[2], flexShrink: 0 }} />
            )}

            <div
                className="mobile-title"
                style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 17,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {pathname.startsWith("/s/") ? <Breadcrumb /> : title}
            </div>

            <button
                onClick={() => navigate("/search")}
                aria-label="Search"
                style={{
                    width: 44,
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: tokens.colors.textSecondary,
                    flexShrink: 0,
                }}
            >
                <Search size={20} strokeWidth={1.9} />
            </button>

            <Dropdown menu={{ items: menuItems }} trigger={["click"]} placement="bottomRight">
                <button
                    aria-label="Menu"
                    style={{
                        width: 44,
                        height: 44,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        flexShrink: 0,
                    }}
                >
                    <Avatar
                        name={`${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim()}
                        src={user?.avatarUrl ?? undefined}
                        size={28}
                    />
                </button>
            </Dropdown>
            <ReportBugButton open={bugOpen} onOpenChange={setBugOpen} />
        </header>
    );
};
