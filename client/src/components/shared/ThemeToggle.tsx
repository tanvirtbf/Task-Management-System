import { Tooltip } from "antd";
import { Moon, Sun } from "lucide-react";
import { useUiStore } from "../../stores/ui";
import { tokens } from "../../theme";

export const ThemeToggle = () => {
    const theme = useUiStore((s) => s.theme);
    const setTheme = useUiStore((s) => s.setTheme);
    const next = theme === "dark" ? "light" : "dark";

    return (
        <Tooltip title={`Switch to ${next} mode`}>
            <button
                onClick={() => setTheme(next)}
                aria-label={`Switch to ${next} mode`}
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: tokens.radius.md,
                    background: "transparent",
                    border: 0,
                    cursor: "pointer",
                    color: tokens.colors.textSecondary,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "background var(--transition-fast)",
                }}
                onMouseEnter={(e) =>
                    (e.currentTarget.style.background = tokens.colors.bgHover)
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                }
            >
                {theme === "dark" ? (
                    <Sun size={16} strokeWidth={1.75} />
                ) : (
                    <Moon size={16} strokeWidth={1.75} />
                )}
            </button>
        </Tooltip>
    );
};
