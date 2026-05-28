import { Select } from "antd";
import { Shield, Calendar } from "lucide-react";
import { useState } from "react";
import { onCallShifts as initialShifts } from "../../mocks/on-call";
import { users, usersById } from "../../mocks/users";
import { Avatar } from "../../components/ui/Avatar";
import { tokens } from "../../theme";

const OnCallRotationPage = () => {
    const [shifts, setShifts] = useState(initialShifts);
    const eligible = users.filter((u) => u.status === "active");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const updateShift = (shiftId: string, engineerId: string) => {
        setShifts((prev) =>
            prev.map((s) => (s.id === shiftId ? { ...s, engineerId } : s)),
        );
    };

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 880,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[4],
            }}
        >
            <div>
                <h1
                    style={{
                        margin: 0,
                        fontSize: tokens.typography.fontSize["2xl"],
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    <Shield size={20} strokeWidth={1.75} color={tokens.colors.warning} />
                    On-call rotation
                </h1>
                <p
                    style={{
                        margin: 0,
                        marginTop: 4,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    Weekly rotation. The on-call engineer auto-receives every
                    new S0/S1 bug and every incident.
                </p>
            </div>

            <div
                style={{
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    overflow: "hidden",
                }}
            >
                {shifts.map((shift) => {
                    const monday = new Date(shift.weekStart);
                    const sunday = new Date(monday);
                    sunday.setDate(sunday.getDate() + 6);
                    const isCurrent =
                        monday <= today &&
                        new Date(sunday.setHours(23, 59, 59, 999)) >= today;
                    const user = usersById.get(shift.engineerId);

                    return (
                        <div
                            key={shift.id}
                            style={{
                                display: "grid",
                                gridTemplateColumns: "32px 1fr 1fr",
                                alignItems: "center",
                                gap: 12,
                                padding: `${tokens.spacing[3]}px ${tokens.spacing[4]}px`,
                                background: isCurrent
                                    ? tokens.colors.primarySubtle
                                    : "transparent",
                                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                            }}
                        >
                            <Calendar
                                size={16}
                                strokeWidth={1.75}
                                color={
                                    isCurrent
                                        ? tokens.colors.primary
                                        : tokens.colors.textMuted
                                }
                            />
                            <div>
                                <div
                                    style={{
                                        fontWeight: 600,
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        color: tokens.colors.textPrimary,
                                    }}
                                >
                                    {monday.toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                    })}{" "}
                                    —{" "}
                                    {sunday.toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                    })}
                                    {isCurrent && (
                                        <span
                                            style={{
                                                marginLeft: 8,
                                                fontSize: 10,
                                                fontWeight: 700,
                                                color: tokens.colors.primary,
                                                background:
                                                    tokens.colors.bgSurface,
                                                padding: "1px 6px",
                                                borderRadius: 3,
                                            }}
                                        >
                                            CURRENT WEEK
                                        </span>
                                    )}
                                </div>
                            </div>
                            <Select
                                value={shift.engineerId}
                                onChange={(v) => updateShift(shift.id, v)}
                                style={{ minWidth: 220 }}
                                options={eligible.map((u) => ({
                                    value: u.id,
                                    label: `${u.firstName} ${u.lastName}`,
                                }))}
                                optionRender={(opt) => {
                                    const u = usersById.get(String(opt.value));
                                    return (
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 6,
                                            }}
                                        >
                                            {u && (
                                                <Avatar
                                                    name={`${u.firstName} ${u.lastName}`}
                                                    src={u.avatarUrl}
                                                    size={18}
                                                />
                                            )}
                                            {opt.label}
                                        </span>
                                    );
                                }}
                                labelRender={() => (
                                    <span
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                        }}
                                    >
                                        {user && (
                                            <Avatar
                                                name={`${user.firstName} ${user.lastName}`}
                                                src={user.avatarUrl}
                                                size={18}
                                            />
                                        )}
                                        {user
                                            ? `${user.firstName} ${user.lastName}`
                                            : "—"}
                                    </span>
                                )}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default OnCallRotationPage;
