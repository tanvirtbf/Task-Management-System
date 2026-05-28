import { Tooltip } from "antd";
import { Shield } from "lucide-react";
import { currentOnCallEngineerId } from "../../mocks/on-call";
import { usersById } from "../../mocks/users";
import { tokens } from "../../theme";
import { useNavigate } from "react-router-dom";

export const OnCallBadge = () => {
    const navigate = useNavigate();
    const engineerId = currentOnCallEngineerId();
    const engineer = usersById.get(engineerId);

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
