import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { tokens } from "../../theme";

interface EmptyStateProps {
    icon?: LucideIcon;
    title: string;
    description?: string;
    action?: ReactNode;
    compact?: boolean;
}

export const EmptyState = ({
    icon: Icon,
    title,
    description,
    action,
    compact = false,
}: EmptyStateProps) => (
    <div
        style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: compact ? tokens.spacing[5] : tokens.spacing[8],
            textAlign: "center",
            gap: tokens.spacing[3],
        }}
    >
        {Icon && (
            <div
                style={{
                    width: compact ? 36 : 48,
                    height: compact ? 36 : 48,
                    borderRadius: tokens.radius.full,
                    background: tokens.colors.bgMuted,
                    color: tokens.colors.textMuted,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <Icon size={compact ? 18 : 22} strokeWidth={1.5} />
            </div>
        )}
        <div>
            <div
                style={{
                    fontSize: compact
                        ? tokens.typography.fontSize.sm
                        : tokens.typography.fontSize.base,
                    fontWeight: 600,
                    color: tokens.colors.textPrimary,
                    marginBottom: description ? 4 : 0,
                }}
            >
                {title}
            </div>
            {description && (
                <div
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textSecondary,
                        maxWidth: 320,
                        lineHeight: 1.5,
                    }}
                >
                    {description}
                </div>
            )}
        </div>
        {action && <div>{action}</div>}
    </div>
);
