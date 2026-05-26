import { tokens } from "../../theme";

interface Props {
    title: string;
    description?: string;
    actions?: React.ReactNode;
}

export const SettingsHeader = ({ title, description, actions }: Props) => (
    <div
        style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: tokens.spacing[5],
        }}
    >
        <div style={{ flex: 1 }}>
            <h1
                style={{
                    margin: 0,
                    fontSize: tokens.typography.fontSize["2xl"],
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                }}
            >
                {title}
            </h1>
            {description && (
                <p
                    style={{
                        margin: 0,
                        marginTop: 4,
                        color: tokens.colors.textSecondary,
                        fontSize: tokens.typography.fontSize.sm,
                        maxWidth: 640,
                    }}
                >
                    {description}
                </p>
            )}
        </div>
        {actions && (
            <div style={{ flexShrink: 0, display: "flex", gap: 8 }}>
                {actions}
            </div>
        )}
    </div>
);

interface SectionProps {
    title?: string;
    description?: string;
    children: React.ReactNode;
}

export const SettingsSection = ({
    title,
    description,
    children,
}: SectionProps) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[4],
            marginBottom: tokens.spacing[3],
        }}
    >
        {title && (
            <div style={{ marginBottom: tokens.spacing[3] }}>
                <h3
                    style={{
                        margin: 0,
                        fontSize: tokens.typography.fontSize.base,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    {title}
                </h3>
                {description && (
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textMuted,
                        }}
                    >
                        {description}
                    </p>
                )}
            </div>
        )}
        {children}
    </div>
);

interface FieldRowProps {
    label: string;
    hint?: string;
    children: React.ReactNode;
    inline?: boolean;
}

export const SettingsFieldRow = ({
    label,
    hint,
    children,
    inline = false,
}: FieldRowProps) => (
    <div
        style={{
            display: inline ? "flex" : "block",
            alignItems: inline ? "center" : undefined,
            justifyContent: inline ? "space-between" : undefined,
            padding: `${tokens.spacing[2]}px 0`,
            borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            gap: 12,
        }}
    >
        <div style={{ flex: inline ? 1 : undefined, minWidth: 0 }}>
            <label
                style={{
                    display: "block",
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: 500,
                    color: tokens.colors.textPrimary,
                    marginBottom: inline ? 0 : 4,
                }}
            >
                {label}
            </label>
            {hint && (
                <p
                    style={{
                        margin: 0,
                        marginTop: inline ? 2 : 0,
                        marginBottom: inline ? 0 : 6,
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                        lineHeight: 1.4,
                    }}
                >
                    {hint}
                </p>
            )}
        </div>
        <div style={{ flexShrink: 0, minWidth: inline ? undefined : "100%" }}>
            {children}
        </div>
    </div>
);
