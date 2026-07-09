import { useMemo } from "react";
import { tokens } from "../../theme";

interface PasswordStrengthMeterProps {
    password: string;
}

type Strength = 0 | 1 | 2 | 3 | 4 | 5;

interface Score {
    strength: Strength;
    label: string;
    color: string;
}

const labelFor = (s: Strength): Score => {
    switch (s) {
        case 0:
            return { strength: 0, label: "Enter a password", color: tokens.colors.border };
        case 1:
            return { strength: 1, label: "Very weak", color: tokens.colors.danger };
        case 2:
            return { strength: 2, label: "Weak", color: tokens.colors.warning };
        case 3:
            return { strength: 3, label: "Fair", color: "#F59E0B" };
        case 4:
            return { strength: 4, label: "Strong", color: tokens.colors.success };
        case 5:
            return { strength: 5, label: "Very strong", color: tokens.colors.success };
    }
};

const scorePassword = (password: string): Strength => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return Math.min(5, score) as Strength;
};

export const PasswordStrengthMeter = ({ password }: PasswordStrengthMeterProps) => {
    const score = useMemo(() => labelFor(scorePassword(password)), [password]);

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[1],
            }}
        >
            <div
                style={{
                    display: "flex",
                    gap: 4,
                    height: 4,
                }}
            >
                {[1, 2, 3, 4, 5].map((bar) => (
                    <div
                        key={bar}
                        style={{
                            flex: 1,
                            height: "100%",
                            borderRadius: 2,
                            background:
                                bar <= score.strength
                                    ? score.color
                                    : tokens.colors.borderSubtle,
                            transition: "background var(--transition-base)",
                        }}
                    />
                ))}
            </div>
            <div
                style={{
                    fontSize: tokens.typography.fontSize.xs,
                    color:
                        score.strength === 0
                            ? tokens.colors.textMuted
                            : score.color,
                    fontWeight: 500,
                }}
            >
                {score.label}
            </div>
        </div>
    );
};
