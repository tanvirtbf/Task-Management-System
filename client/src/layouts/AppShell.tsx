import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "../components/shared/Sidebar";
import { Topbar } from "../components/shared/Topbar";
import { CommandPalette } from "../components/search/CommandPalette";
import { ShortcutsModal } from "../components/shared/ShortcutsModal";
import { OfflineIndicator } from "../components/shared/OfflineIndicator";
import { tokens } from "../theme";

const NAV_BY_KEY: Record<string, string> = {
    h: "/",
    i: "/inbox",
    s: "/search",
    d: "/dashboards",
    a: "/automations",
    t: "/templates",
    n: "/notepad",
    r: "/reminders",
    f: "/forms",
    ",": "/settings",
};

const isEditableTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return false;
};

const AppShell = () => {
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const navigate = useNavigate();
    /** Tracks "g" prefix state for vim-style navigation. */
    const gPendingRef = useRef<number | null>(null);

    useEffect(() => {
        const clearG = () => {
            if (gPendingRef.current) {
                window.clearTimeout(gPendingRef.current);
                gPendingRef.current = null;
            }
        };

        const onKey = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;

            // ⌘K — command palette (works even in inputs)
            if (mod && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setPaletteOpen((o) => !o);
                return;
            }

            // Ignore other shortcuts while typing
            if (isEditableTarget(e.target)) return;

            // ? — shortcuts help
            if (e.key === "?" && !mod) {
                e.preventDefault();
                setShortcutsOpen(true);
                return;
            }

            // g + letter navigation
            if (e.key === "g" && !mod) {
                e.preventDefault();
                clearG();
                gPendingRef.current = window.setTimeout(clearG, 1500);
                return;
            }
            if (gPendingRef.current && NAV_BY_KEY[e.key.toLowerCase()]) {
                e.preventDefault();
                navigate(NAV_BY_KEY[e.key.toLowerCase()]);
                clearG();
                return;
            }
            if (gPendingRef.current) clearG();
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            clearG();
        };
    }, [navigate]);

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
            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
            />
            <ShortcutsModal
                open={shortcutsOpen}
                onClose={() => setShortcutsOpen(false)}
            />
            <OfflineIndicator />
        </div>
    );
};

export default AppShell;
