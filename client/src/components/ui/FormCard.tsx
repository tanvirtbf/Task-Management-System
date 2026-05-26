import type { ReactNode } from "react";
import { tokens } from "../../theme";
import { Logo } from "./Logo";

interface FormCardProps {
    title?: string;
    description?: string;
    children: ReactNode;
    footer?: ReactNode;
    width?: number;
    /** Show the wordmark logo above the card. Default true. */
    showLogo?: boolean;
}

/**
 * Reusable centered card for auth pages.
 * Pairs with AuthLayout right-panel area.
 */
export const FormCard = ({
    title,
    description,
    children,
    footer,
    width = 400,
    showLogo = true,
}: FormCardProps) => (
    <div
        style={{
            width: "100%",
            maxWidth: width,
            display: "flex",
            flexDirection: "column",
            gap: tokens.spacing[6],
        }}
    >
        {showLogo && (
            <div style={{ display: "flex", justifyContent: "center" }}>
                <Logo size={32} />
            </div>
        )}

        <div
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.xl,
                padding: tokens.spacing[8],
                boxShadow: tokens.shadows.sm,
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[6],
            }}
        >
            {(title || description) && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[1],
                    }}
                >
                    {title && (
                        <h1
                            style={{
                                fontSize: tokens.typography.fontSize["2xl"],
                                fontWeight: 600,
                                color: tokens.colors.textPrimary,
                                margin: 0,
                                letterSpacing: "-0.02em",
                            }}
                        >
                            {title}
                        </h1>
                    )}
                    {description && (
                        <p
                            style={{
                                fontSize: tokens.typography.fontSize.base,
                                color: tokens.colors.textSecondary,
                                margin: 0,
                            }}
                        >
                            {description}
                        </p>
                    )}
                </div>
            )}

            {children}
        </div>

        {footer && (
            <div
                style={{
                    textAlign: "center",
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textSecondary,
                }}
            >
                {footer}
            </div>
        )}
    </div>
);
