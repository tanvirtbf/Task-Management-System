import type { LucideIcon } from "lucide-react";
import { tokens } from "../../theme";

interface ComingSoonPageProps {
    icon: LucideIcon;
    title: string;
    description: string;
    phase: string;
}

/**
 * Placeholder for pages that will be implemented in later phases.
 * Used as a stub so sidebar/topbar links don't 404.
 */
export const ComingSoonPage = ({
    icon: Icon,
    title,
    description,
    phase,
}: ComingSoonPageProps) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "calc(100vh - 48px)",
            padding: tokens.spacing[8],
        }}
    >
        <div
            style={{
                maxWidth: 480,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: tokens.spacing[4],
            }}
        >
            <div
                style={{
                    width: 64,
                    height: 64,
                    borderRadius: tokens.radius.xl,
                    background: tokens.colors.primarySubtle,
                    color: tokens.colors.primary,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <Icon size={28} strokeWidth={1.5} />
            </div>
            <div>
                <h1
                    style={{
                        fontSize: tokens.typography.fontSize["2xl"],
                        fontWeight: 700,
                        color: tokens.colors.textPrimary,
                        margin: 0,
                        marginBottom: tokens.spacing[2],
                        letterSpacing: "-0.02em",
                    }}
                >
                    {title}
                </h1>
                <p
                    style={{
                        fontSize: tokens.typography.fontSize.base,
                        color: tokens.colors.textSecondary,
                        margin: 0,
                        lineHeight: 1.6,
                    }}
                >
                    {description}
                </p>
            </div>
            <div
                style={{
                    padding: "6px 14px",
                    background: tokens.colors.bgMuted,
                    borderRadius: tokens.radius.full,
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textSecondary,
                    fontWeight: 500,
                }}
            >
                Coming in <strong>{phase}</strong>
            </div>
        </div>
    </div>
);
