import { Tooltip } from "antd";
import { Avatar } from "./Avatar";
import { tokens } from "../../theme";

interface AssigneeStackProps {
    users: Array<{ id: string; firstName: string; lastName: string; avatarUrl: string | null }>;
    size?: number;
    max?: number;
}

export const AssigneeStack = ({ users, size = 24, max = 3 }: AssigneeStackProps) => {
    if (users.length === 0) {
        return (
            <span
                style={{
                    fontSize: tokens.typography.fontSize.xs,
                    color: tokens.colors.textMuted,
                }}
            >
                —
            </span>
        );
    }

    const shown = users.slice(0, max);
    const overflow = users.length - shown.length;

    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
            }}
        >
            {shown.map((user, idx) => (
                <Tooltip
                    key={user.id}
                    title={`${user.firstName} ${user.lastName}`}
                >
                    <span
                        style={{
                            marginLeft: idx === 0 ? 0 : -6,
                            zIndex: shown.length - idx,
                        }}
                    >
                        <Avatar
                            name={`${user.firstName} ${user.lastName}`}
                            src={user.avatarUrl}
                            size={size}
                            bordered
                        />
                    </span>
                </Tooltip>
            ))}
            {overflow > 0 && (
                <Tooltip title={`+${overflow} more`}>
                    <span
                        style={{
                            marginLeft: -6,
                            width: size,
                            height: size,
                            borderRadius: "50%",
                            background: tokens.colors.bgMuted,
                            color: tokens.colors.textSecondary,
                            fontSize: Math.max(10, Math.round(size * 0.4)),
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: `0 0 0 2px ${tokens.colors.bgSurface}`,
                        }}
                    >
                        +{overflow}
                    </span>
                </Tooltip>
            )}
        </div>
    );
};
