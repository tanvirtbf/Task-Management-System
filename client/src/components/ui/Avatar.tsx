import { tokens } from "../../theme";

interface AvatarProps {
    name: string;
    src?: string | null;
    size?: number;
    /** Optional border (used by AssigneeStack to overlap). */
    bordered?: boolean;
}

const colorFromName = (name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const palette = [
        "#4F46E5",
        "#10B981",
        "#F59E0B",
        "#E11D48",
        "#8B5CF6",
        "#06B6D4",
        "#EC4899",
        "#0EA5E9",
    ];
    return palette[Math.abs(hash) % palette.length];
};

const initialsOf = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
    return ((parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "")).toUpperCase();
};

export const Avatar = ({
    name,
    src,
    size = 24,
    bordered = false,
}: AvatarProps) => {
    const fontSize = Math.max(10, Math.round(size * 0.42));
    const base = {
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: colorFromName(name),
        color: "#FFFFFF",
        fontWeight: 600,
        fontSize,
        userSelect: "none" as const,
        letterSpacing: "0.02em",
        overflow: "hidden" as const,
        boxShadow: bordered ? `0 0 0 2px ${tokens.colors.bgSurface}` : undefined,
    };

    if (src) {
        return (
            <span
                style={base}
                role="img"
                aria-label={name}
                title={name}
            >
                <img
                    src={src}
                    alt={name}
                    width={size}
                    height={size}
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                    }}
                    onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                />
            </span>
        );
    }

    return (
        <span style={base} role="img" aria-label={name} title={name}>
            {initialsOf(name)}
        </span>
    );
};
