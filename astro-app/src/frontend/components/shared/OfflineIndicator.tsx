import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { tokens } from "../../theme";

export const OfflineIndicator = () => {
    const [online, setOnline] = useState(
        typeof navigator !== "undefined" ? navigator.onLine : true,
    );

    useEffect(() => {
        const goOnline = () => setOnline(true);
        const goOffline = () => setOnline(false);
        window.addEventListener("online", goOnline);
        window.addEventListener("offline", goOffline);
        return () => {
            window.removeEventListener("online", goOnline);
            window.removeEventListener("offline", goOffline);
        };
    }, []);

    if (online) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                position: "fixed",
                bottom: 16,
                left: "50%",
                transform: "translateX(-50%)",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: tokens.colors.textPrimary,
                color: tokens.colors.textInverse,
                padding: "8px 14px",
                borderRadius: tokens.radius.full,
                fontSize: tokens.typography.fontSize.sm,
                fontWeight: 500,
                boxShadow: tokens.shadows.lg,
                zIndex: tokens.zIndex.toast,
                animation: "slideUp var(--transition-slow)",
            }}
        >
            <WifiOff size={14} strokeWidth={1.75} />
            <span>You're offline — changes will sync when reconnected.</span>
        </div>
    );
};
