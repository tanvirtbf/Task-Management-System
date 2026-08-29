import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useIsMobile } from "../../hooks/useIsMobile";
import { tokens } from "../../theme";

/**
 * P8 of MOBILE_REBUILD_PLAN.md — offer the install.
 *
 * The app has had a manifest and a service worker for months and **nothing ever
 * offered installation**, so nobody installed it. On Android that is one line
 * of plumbing: the browser fires `beforeinstallprompt` when it considers the
 * app installable, you keep the event, and you replay it when the user says yes.
 *
 * iOS never fires that event — Safari only installs through Share → Add to Home
 * Screen. That path matters more here than on most apps, because it is the
 * **only** way iOS delivers Web Push, which is the reason this app has a
 * manifest at all. So iPhone users get the instruction instead of a button.
 *
 * Shown once. Dismissal is remembered, and the prompt never appears again after
 * the app is installed (`display-mode: standalone` means we are already inside it).
 */
const DISMISSED_KEY = "bb-install-dismissed";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS reports it here instead.
    (window.navigator as { standalone?: boolean }).standalone === true;

const isIos = () =>
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
    !/crios|fxios/i.test(window.navigator.userAgent);

export const InstallPrompt = () => {
    const isMobile = useIsMobile();
    const [deferred, setDeferred] = useState<InstallEvent | null>(null);
    const [dismissed, setDismissed] = useState(() => {
        try {
            return localStorage.getItem(DISMISSED_KEY) === "1";
        } catch {
            return false;
        }
    });

    useEffect(() => {
        if (dismissed || isStandalone()) return;
        const onPrompt = (e: Event) => {
            e.preventDefault(); // stop Chrome's own mini-infobar; we choose the moment
            setDeferred(e as InstallEvent);
        };
        window.addEventListener("beforeinstallprompt", onPrompt);
        return () => window.removeEventListener("beforeinstallprompt", onPrompt);
    }, [dismissed]);

    // Safari never fires beforeinstallprompt, so iPhones get the Share-sheet
    // instruction instead — derived, not stored.
    const showIosHint = !deferred && isIos() && !isStandalone();

    const close = () => {
        setDismissed(true);
        setDeferred(null);
        try {
            localStorage.setItem(DISMISSED_KEY, "1");
        } catch {
            /* private mode — it will simply ask again next time */
        }
    };

    if (!isMobile || dismissed || (!deferred && !showIosHint)) return null;

    return (
        <div
            className="bb-bottom-floating"
            role="dialog"
            aria-label="Install BB Tasks"
            style={{
                position: "fixed",
                left: 12,
                right: 12,
                bottom: 16,
                display: "flex",
                alignItems: "center",
                gap: tokens.spacing[3],
                padding: `${tokens.spacing[3]}px ${tokens.spacing[3]}px`,
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                boxShadow: tokens.shadows.lg,
                zIndex: 1029,
            }}
        >
            <span
                style={{
                    width: 36,
                    height: 36,
                    flexShrink: 0,
                    borderRadius: tokens.radius.md,
                    background: tokens.colors.primary,
                    color: "#FFFFFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <Download size={18} strokeWidth={1.9} />
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "17px" }}>
                {deferred ? (
                    <>Add BB Tasks to your home screen for a full-screen app.</>
                ) : (
                    <>
                        Add to your home screen: tap <b>Share</b>, then{" "}
                        <b>Add to Home Screen</b>.
                    </>
                )}
            </span>
            {deferred && (
                <button
                    onClick={async () => {
                        try {
                            await deferred.prompt();
                            await deferred.userChoice;
                        } catch {
                            /* dismissed or unavailable — either way we are done asking */
                        }
                        close();
                    }}
                    style={{
                        flexShrink: 0,
                        minHeight: 44,
                        padding: `0 ${tokens.spacing[3]}px`,
                        background: tokens.colors.primary,
                        color: "#FFFFFF",
                        border: "none",
                        borderRadius: tokens.radius.md,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                    }}
                >
                    Install
                </button>
            )}
            <button
                onClick={close}
                aria-label="Not now"
                style={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: tokens.colors.textMuted,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <X size={18} strokeWidth={1.9} />
            </button>
        </div>
    );
};
