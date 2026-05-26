import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

export const NotificationBell = () => {
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const { data: count = 0 } = useQuery({
        queryKey: ["notifications", "unread-count", user?.id],
        queryFn: () => (user ? mockApi.notifications.unreadCount(user.id) : 0),
        enabled: !!user,
    });

    return (
        <button
            onClick={() => navigate("/inbox")}
            style={{
                position: "relative",
                width: 32,
                height: 32,
                borderRadius: tokens.radius.md,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: tokens.colors.textSecondary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all var(--transition-base)",
            }}
            onMouseEnter={(e) =>
                (e.currentTarget.style.background = tokens.colors.bgHover)
            }
            onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
            }
            title={count > 0 ? `${count} unread` : "Inbox"}
        >
            <Bell size={16} strokeWidth={1.75} />
            {count > 0 && (
                <span
                    style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 8,
                        background: tokens.colors.danger,
                        color: "#FFFFFF",
                        fontSize: 10,
                        fontWeight: 600,
                        fontFamily: tokens.typography.fontFamilyMono,
                        padding: "0 4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: `0 0 0 2px ${tokens.colors.bgSurface}`,
                    }}
                >
                    {count}
                </span>
            )}
        </button>
    );
};
