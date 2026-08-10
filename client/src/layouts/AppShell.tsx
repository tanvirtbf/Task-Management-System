import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "../components/shared/Sidebar";
import { Topbar } from "../components/shared/Topbar";
import { OfflineIndicator } from "../components/shared/OfflineIndicator";
import { PushPrompt } from "../components/shared/PushPrompt";
import { AssistantWidget } from "../components/assistant/AssistantWidget";
import { useInboxStream } from "../hooks/useInboxStream";
import { tokens } from "../theme";

/**
 * F34 (ISS-096): the ⌘K / Ctrl-K shortcut the Sidebar has ADVERTISED since P8
 * (`<KbdHint k="⌘K" />` on the Search item) with nothing behind it — the exact
 * "UI promises what nothing does" family Block F spent four phases removing.
 * Bound here because AppShell wraps every authenticated page, so the promise
 * holds everywhere the badge is visible. Typing surfaces are exempt: inside an
 * input, textarea or rich-text editor (contenteditable), Ctrl-K belongs to the
 * field (tiptap uses it for links), not to navigation.
 */
const isTypingTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    return (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
    );
};

const useSearchShortcut = () => {
    const navigate = useNavigate();
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== "k" || (!e.metaKey && !e.ctrlKey))
                return;
            if (e.altKey || e.shiftKey) return;
            if (isTypingTarget(e.target)) return;
            e.preventDefault();
            navigate("/search");
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [navigate]);
};

/**
 * Persistent shell for all authenticated routes.
 * Sidebar (left) + Topbar + scrollable content area.
 */
const AppShell = () => {
    useSearchShortcut();
    // §29c Level 1 — one live inbox stream per signed-in app instance, so the
    // bell badge and Inbox react in ~a second instead of on the 60s poll.
    useInboxStream();
    return (
    <div
        style={{
            display: "flex",
            minHeight: "100vh",
            background: tokens.colors.bgPage,
            color: tokens.colors.textPrimary,
        }}
    >
        <Sidebar />
        <div
            style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
            }}
        >
            <Topbar />
            <main
                style={{
                    flex: 1,
                    overflow: "auto",
                    minHeight: 0,
                }}
            >
                <Outlet />
            </main>
        </div>
        <OfflineIndicator />
        {/* §29c Level 2 — the once-per-device ask for browser notifications. */}
        <PushPrompt />
        <AssistantWidget />
    </div>
    );
};

export default AppShell;
