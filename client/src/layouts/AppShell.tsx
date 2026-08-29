import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "../components/shared/Sidebar";
import { Topbar } from "../components/shared/Topbar";
import { MobileTopBar } from "../components/shared/MobileTopBar";
import { MobileTabBar, TAB_BAR_HEIGHT } from "../components/shared/MobileTabBar";
import { OfflineIndicator } from "../components/shared/OfflineIndicator";
import { PushPrompt } from "../components/shared/PushPrompt";
import { InstallPrompt } from "../components/shared/InstallPrompt";
import { AssistantWidget } from "../components/assistant/AssistantWidget";
import { useInboxStream } from "../hooks/useInboxStream";
import { useIsMobile } from "../hooks/useIsMobile";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
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
 *
 * Two shells, one boundary (D2 of MOBILE_REBUILD_PLAN.md). Below 768px the
 * phone shell renders — a compact top bar, the page, and a bottom tab bar — and
 * the sidebar is not mounted at all. At and above 768px this is the same
 * desktop shell it has always been, deliberately untouched: `desktop-guard.pw.ts`
 * asserts that on every run.
 */
const AppShell = () => {
    useSearchShortcut();
    // §29c Level 1 — one live inbox stream per signed-in app instance, so the
    // bell badge and Inbox react in ~a second instead of on the 60s poll.
    useInboxStream();
    const isMobile = useIsMobile();
    // Publishes `--kb-inset` and tells the tab bar to get out of the keyboard's
    // way. Mounted for both shells; on a desktop browser it simply never fires.
    const keyboardOpen = useKeyboardInset();

    if (isMobile) {
        return (
            <div
                style={{
                    // svh, not dvh: dvh changes as the URL bar shows and hides,
                    // which would resize the shell mid-scroll (W4 in the plan).
                    height: "100svh",
                    display: "flex",
                    flexDirection: "column",
                    background: tokens.colors.bgPage,
                    color: tokens.colors.textPrimary,
                }}
            >
                <MobileTopBar />
                <main
                    style={{
                        flex: 1,
                        minHeight: 0,
                        // A scroll container, exactly like the desktop shell.
                        // Without it a page that overflows horizontally widens
                        // the DOCUMENT, and mobile browsers respond by zooming
                        // the whole layout out — which drops a fixed bottom bar
                        // below the fold. Screens still overflow until P5 and P6
                        // reshape them, so the shell has to survive that.
                        overflow: "auto",
                        // Room for the fixed tab bar, plus the home indicator.
                        paddingBottom: `calc(${TAB_BAR_HEIGHT}px + var(--safe-bottom, 0px))`,
                    }}
                >
                    <Outlet />
                </main>
                <OfflineIndicator />
                <PushPrompt />
                <InstallPrompt />
                <AssistantWidget />
                <MobileTabBar hidden={keyboardOpen} />
            </div>
        );
    }

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
