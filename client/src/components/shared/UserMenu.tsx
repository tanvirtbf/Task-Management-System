import { Dropdown } from "antd";
import { useNavigate } from "react-router-dom";
import {
    LogOut,
    Settings,
    ShieldCheck,
    User as UserIcon,
    Sun,
} from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

export const UserMenu = () => {
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();

    if (!user) return null;

    const fullName = `${user.firstName} ${user.lastName}`;

    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            dropdownRender={() => (
                <div
                    style={{
                        width: 240,
                        background: tokens.colors.bgSurface,
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.lg,
                        boxShadow: tokens.shadows.md,
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            padding: tokens.spacing[3],
                            borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                            display: "flex",
                            alignItems: "center",
                            gap: tokens.spacing[2],
                        }}
                    >
                        <Avatar name={fullName} src={user.avatarUrl} size={36} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                                style={{
                                    fontWeight: 600,
                                    fontSize: tokens.typography.fontSize.sm,
                                    color: tokens.colors.textPrimary,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {fullName}
                            </div>
                            <div
                                style={{
                                    fontSize: 11,
                                    color: tokens.colors.textMuted,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    fontFamily: tokens.typography.fontFamilyMono,
                                }}
                            >
                                {user.email}
                            </div>
                        </div>
                        <span
                            style={{
                                padding: "2px 8px",
                                background: tokens.colors.primarySubtle,
                                color: tokens.colors.primary,
                                fontSize: 11,
                                fontWeight: 500,
                                borderRadius: tokens.radius.full,
                                flexShrink: 0,
                                textTransform: "capitalize",
                            }}
                        >
                            {user.role}
                        </span>
                    </div>

                    <div style={{ padding: 4 }}>
                        <MenuRow
                            icon={<UserIcon size={14} strokeWidth={1.75} />}
                            label="Profile"
                            onClick={() => navigate("/settings/profile")}
                        />
                        <MenuRow
                            icon={<ShieldCheck size={14} strokeWidth={1.75} />}
                            label="Security & 2FA"
                            onClick={() => navigate("/2fa-setup")}
                        />
                        <MenuRow
                            icon={<Settings size={14} strokeWidth={1.75} />}
                            label="Workspace settings"
                            onClick={() => navigate("/settings")}
                        />
                        <MenuRow
                            icon={<Sun size={14} strokeWidth={1.75} />}
                            label="Toggle theme (V12)"
                            onClick={() => {}}
                            disabled
                        />
                    </div>

                    <div
                        style={{
                            borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                            padding: 4,
                        }}
                    >
                        <MenuRow
                            icon={<LogOut size={14} strokeWidth={1.75} />}
                            label="Sign out"
                            danger
                            onClick={() => {
                                logout();
                                navigate("/login");
                            }}
                        />
                    </div>
                </div>
            )}
        >
            <button
                style={{
                    background: "none",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    borderRadius: "50%",
                    transition: "all var(--transition-base)",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = `0 0 0 2px ${tokens.colors.primarySubtle}`;
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "none";
                }}
                title={fullName}
            >
                <Avatar name={fullName} src={user.avatarUrl} size={28} />
            </button>
        </Dropdown>
    );
};

interface MenuRowProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
}
const MenuRow = ({ icon, label, onClick, danger, disabled }: MenuRowProps) => (
    <button
        onClick={onClick}
        disabled={disabled}
        style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 10px",
            background: "none",
            border: 0,
            cursor: disabled ? "not-allowed" : "pointer",
            borderRadius: tokens.radius.md,
            color: danger
                ? tokens.colors.danger
                : disabled
                  ? tokens.colors.textMuted
                  : tokens.colors.textPrimary,
            fontSize: tokens.typography.fontSize.sm,
            opacity: disabled ? 0.6 : 1,
            transition: "background var(--transition-base)",
        }}
        onMouseEnter={(e) => {
            if (!disabled)
                e.currentTarget.style.background = danger
                    ? "#FEF2F2"
                    : tokens.colors.bgHover;
        }}
        onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
        }
    >
        <span style={{ display: "inline-flex", color: "currentcolor" }}>
            {icon}
        </span>
        {label}
    </button>
);
