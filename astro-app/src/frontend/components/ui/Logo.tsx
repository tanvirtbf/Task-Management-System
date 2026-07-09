import { tokens } from "../../theme";

interface LogoProps {
    /** Size of the symbol in px. Default 28. */
    size?: number;
    /** Show wordmark next to symbol. Default true. */
    showWordmark?: boolean;
    /** Render dark/inverse variant (for use on colored backgrounds). */
    inverse?: boolean;
    /** Optional className wrapper. */
    className?: string;
}

/**
 * Brand logo for TaskHub.
 *
 * Visual mark: layered rounded squares with checkmark — reads as "stacked
 * tasks complete". Geometric, distinctive, scales cleanly.
 */
export const Logo = ({
    size = 28,
    showWordmark = true,
    inverse = false,
    className,
}: LogoProps) => {
    const primary = inverse ? "#FFFFFF" : tokens.colors.primary;
    const primarySubtle = inverse
        ? "rgba(255, 255, 255, 0.35)"
        : "rgba(79, 70, 229, 0.22)";
    const checkColor = inverse ? tokens.colors.primary : "#FFFFFF";

    return (
        <div
            className={className}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                lineHeight: 1,
                color: inverse ? "#FFFFFF" : tokens.colors.textPrimary,
            }}
        >
            <LogoSymbol
                size={size}
                primary={primary}
                primarySubtle={primarySubtle}
                checkColor={checkColor}
            />
            {showWordmark && (
                <span
                    style={{
                        fontFamily: tokens.typography.fontFamily,
                        fontWeight: 700,
                        fontSize: Math.round(size * 0.62),
                        letterSpacing: "-0.02em",
                    }}
                >
                    TaskHub
                </span>
            )}
        </div>
    );
};

interface LogoSymbolProps {
    size: number;
    primary: string;
    primarySubtle: string;
    checkColor: string;
}

const LogoSymbol = ({
    size,
    primary,
    primarySubtle,
    checkColor,
}: LogoSymbolProps) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="TaskHub logo"
        role="img"
    >
        {/* Back layer (subtle) */}
        <rect x="3" y="3" width="22" height="22" rx="6" fill={primarySubtle} />
        {/* Front layer (primary) */}
        <rect x="8" y="8" width="22" height="22" rx="6" fill={primary} />
        {/* Checkmark */}
        <path
            d="M14.5 18.5 L17.5 21.5 L23.5 14"
            stroke={checkColor}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
        />
    </svg>
);
