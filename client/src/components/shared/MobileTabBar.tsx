import { useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Home, Inbox, Plus, Layers, Search } from "lucide-react";
import { notificationsApi } from "../../http/api";
import { useAuthStore } from "../../stores/auth";
import { CreateTaskModal } from "./CreateTaskModal";
import { tokens } from "../../theme";

/**
 * P3 of MOBILE_REBUILD_PLAN.md — the phone's primary navigation.
 *
 * Replaces the 56px sidebar rail, which held only Home, Inbox and Search and
 * left the entire space tree, SLA, Department, Reports and Engineering with no
 * door at all below 640px. The five slots are D4 of the plan, chosen from what
 * ~100 BeautyBooth staff actually do in a day:
 *
 *   Home    the only screen that answers "amar ki kaj"
 *   Inbox   where a push notification lands, so the usual way in
 *   ＋      one tap to create, replacing a dropdown-then-modal
 *   Spaces  the tree, which simply did not exist on a phone before
 *   Search  the fastest way to a task you can name
 *
 * The assistant briefly lived in the fifth slot. It reads better as the purple
 * robot button people already recognise from the desktop, so it kept that and
 * gave the slot back — see `.asst-fab` in mobile.css.
 *
 * Deliberately no "More" tab — that is where features go to die. The weekly and
 * admin destinations (SLA, Department, Reports, Engineering, Settings) hang off
 * the avatar in the top bar, which is where people look for them anyway.
 *
 * Height is 56px plus the home-indicator inset. z-index is 1030: above the
 * assistant's old 1020 slot, below drawers and modals at 1040 (D6).
 */
export const TAB_BAR_HEIGHT = 56;

type Tab = {
    key: string;
    label: string;
    icon: React.ReactNode;
    /** Matches when the current path starts with this. */
    match?: string;
    onClick: () => void;
    badge?: number;
    accent?: boolean;
};

export const MobileTabBar = ({ hidden = false }: { hidden?: boolean }) => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const user = useAuthStore((s) => s.user);
    const [createOpen, setCreateOpen] = useState(false);
    // Standing in a list, "＋" should mean "a task here" — not "pick a list
    // again". Two taps and a name instead of four taps and a name.
    const listMatch = useMatch("/s/:spaceId/l/:listId/*");
    const listExact = useMatch("/s/:spaceId/l/:listId");
    const currentListId =
        listExact?.params.listId ?? listMatch?.params.listId;

    const { data: unread = 0 } = useQuery({
        queryKey: ["notifications", "unread-count", user?.id],
        queryFn: () => notificationsApi.unreadCount(),
        enabled: !!user,
        refetchInterval: 60_000,
    });

    const tabs: Tab[] = [
        {
            key: "home",
            label: "Home",
            icon: <Home size={20} strokeWidth={1.9} />,
            match: "/",
            onClick: () => navigate("/"),
        },
        {
            key: "inbox",
            label: "Inbox",
            icon: <Inbox size={20} strokeWidth={1.9} />,
            match: "/inbox",
            onClick: () => navigate("/inbox"),
            badge: unread,
        },
        {
            key: "create",
            label: "New",
            icon: <Plus size={22} strokeWidth={2.2} />,
            onClick: () => setCreateOpen(true),
            accent: true,
        },
        {
            key: "spaces",
            label: "Spaces",
            icon: <Layers size={20} strokeWidth={1.9} />,
            match: "/spaces",
            onClick: () => navigate("/spaces"),
        },
        {
            key: "search",
            label: "Search",
            icon: <Search size={20} strokeWidth={1.9} />,
            match: "/search",
            onClick: () => navigate("/search"),
        },
    ];

    const isActive = (t: Tab) => {
        if (!t.match) return false;
        if (t.match === "/") return pathname === "/";
        return pathname.startsWith(t.match);
    };

    return (
        <>
            <nav
                aria-label="Primary"
                data-testid="mobile-tab-bar"
                style={{
                    position: "fixed",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    // The keyboard shrinks the visual viewport but leaves fixed
                    // elements where they were, so a bar that stayed put would
                    // sit on top of the field being typed into.
                    transform: hidden ? "translateY(110%)" : "none",
                    transition: "transform 160ms ease",
                    height: `calc(${TAB_BAR_HEIGHT}px + var(--safe-bottom, 0px))`,
                    paddingBottom: "var(--safe-bottom, 0px)",
                    display: "flex",
                    alignItems: "stretch",
                    background: tokens.colors.bgSurface,
                    borderTop: `1px solid ${tokens.colors.border}`,
                    zIndex: 1030,
                }}
            >
                {tabs.map((t) => {
                    const active = isActive(t);
                    return (
                        <button
                            key={t.key}
                            onClick={t.onClick}
                            aria-label={t.label}
                            aria-current={active ? "page" : undefined}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 3,
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                position: "relative",
                                color: active
                                    ? tokens.colors.primary
                                    : tokens.colors.textMuted,
                                padding: 0,
                            }}
                        >
                            <span
                                style={
                                    t.accent
                                        ? {
                                              width: 38,
                                              height: 38,
                                              borderRadius: tokens.radius.md,
                                              background: tokens.colors.primary,
                                              color: "#FFFFFF",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                          }
                                        : { display: "flex" }
                                }
                            >
                                {t.icon}
                            </span>
                            {!t.accent && (
                                <span
                                    style={{
                                        fontSize: 11,
                                        lineHeight: 1,
                                        fontWeight: active ? 600 : 500,
                                    }}
                                >
                                    {t.label}
                                </span>
                            )}
                            {!!t.badge && t.badge > 0 && (
                                <span
                                    style={{
                                        position: "absolute",
                                        top: 6,
                                        left: "calc(50% + 4px)",
                                        minWidth: 16,
                                        height: 16,
                                        padding: "0 4px",
                                        borderRadius: 8,
                                        background: tokens.colors.danger,
                                        color: "#FFFFFF",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        lineHeight: "16px",
                                        textAlign: "center",
                                    }}
                                >
                                    {t.badge > 99 ? "99+" : t.badge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>
            {createOpen && (
                <CreateTaskModal
                    defaultListId={currentListId}
                    onClose={() => setCreateOpen(false)}
                />
            )}
        </>
    );
};
