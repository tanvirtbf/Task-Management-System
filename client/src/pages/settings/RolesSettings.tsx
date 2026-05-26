import { useQuery } from "@tanstack/react-query";
import { Check, Crown, ShieldCheck, User, UserMinus } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";

const ROLE_ICONS = {
    owner: { icon: Crown, color: "#8B5CF6" },
    admin: { icon: ShieldCheck, color: "#4F46E5" },
    member: { icon: User, color: "#10B981" },
    guest: { icon: UserMinus, color: "#F59E0B" },
} as const;

const RolesSettings = () => {
    const { data: roles = [] } = useQuery({
        queryKey: ["roles"],
        queryFn: () => mockApi.roles.list(),
    });

    return (
        <div>
            <SettingsHeader
                title="Roles & permissions"
                description="Built-in workspace roles. Custom roles are available on paid plans."
            />

            {roles.map((r) => {
                const { icon: Icon, color } = ROLE_ICONS[r.role];
                return (
                    <SettingsSection key={r.role}>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 12,
                                marginBottom: tokens.spacing[3],
                            }}
                        >
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: tokens.radius.md,
                                    background: `${color}1A`,
                                    color,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <Icon size={20} strokeWidth={1.75} />
                            </div>
                            <div>
                                <h3
                                    style={{
                                        margin: 0,
                                        fontSize:
                                            tokens.typography.fontSize.base,
                                        fontWeight: 700,
                                    }}
                                >
                                    {r.label}
                                </h3>
                                <p
                                    style={{
                                        margin: 0,
                                        marginTop: 2,
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        color: tokens.colors.textSecondary,
                                        lineHeight: 1.5,
                                    }}
                                >
                                    {r.description}
                                </p>
                            </div>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                paddingLeft: 52,
                            }}
                        >
                            {r.permissions.map((p) => (
                                <div
                                    key={p}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        color: tokens.colors.textSecondary,
                                    }}
                                >
                                    <Check
                                        size={13}
                                        strokeWidth={2}
                                        color={tokens.colors.success}
                                    />
                                    {p}
                                </div>
                            ))}
                        </div>
                    </SettingsSection>
                );
            })}
        </div>
    );
};

export default RolesSettings;
