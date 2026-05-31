import { Tooltip } from "antd";
import { Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { onCallApi } from "../../http/api";
import { tokens } from "../../theme";
import { useNavigate } from "react-router-dom";

export const OnCallBadge = () => {
    const navigate = useNavigate();
    const { data: shift } = useQuery({
        queryKey: ["on-call", "current"],
        queryFn: () => onCallApi.current(),
    });
    const engineer = shift?.engineer;

    if (!engineer) return null;

    const initials = `${engineer.firstName[0] ?? ""}${engineer.lastName[0] ?? ""}`;
    const fullName = `${engineer.firstName} ${engineer.lastName}`;

    return (
        <Tooltip title={`On-call this week: ${fullName}. Click to view rotation.`}>
            <button
                onClick={() => navigate("/eng/on-call")}
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: tokens.radius.md,
                    border: `1px solid ${tokens.colors.border}`,
                    background: tokens.colors.bgSurface,
                    color: tokens.colors.textSecondary,
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all var(--transition-base)",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = tokens.colors.warning;
                    e.currentTarget.style.background = `${tokens.colors.warning}0F`;
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = tokens.colors.border;
                    e.currentTarget.style.background = tokens.colors.bgSurface;
                }}
            >
                <Shield size={12} strokeWidth={1.75} color={tokens.colors.warning} />
                <span
                    style={{
                        fontSize: 10,
                        color: tokens.colors.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontWeight: 600,
                    }}
                >
                    On-call
                </span>
                <span
                    style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: tokens.colors.warning,
                        color: "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        fontWeight: 700,
                    }}
                >
                    {initials}
                </span>
            </button>
        </Tooltip>
    );
};
