import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { tokens } from "../../theme";

/**
 * Search pill in the topbar — navigates to the search page on click.
 */
export const CommandPaletteTrigger = () => {
    const navigate = useNavigate();
    return (
        <button
            onClick={() => navigate("/search")}
            aria-label="Search"
            title="Search"
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                maxWidth: 480,
                height: 32,
                padding: "0 10px",
                borderRadius: tokens.radius.md,
                border: `1px solid ${tokens.colors.border}`,
                background: tokens.colors.bgPage,
                color: tokens.colors.textMuted,
                fontSize: tokens.typography.fontSize.sm,
                cursor: "pointer",
                transition: "all var(--transition-base)",
            }}
            onMouseEnter={(e) =>
                (e.currentTarget.style.background = tokens.colors.bgSurface)
            }
            onMouseLeave={(e) =>
                (e.currentTarget.style.background = tokens.colors.bgPage)
            }
        >
            <Search size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />
            {/* F34 (ISS-097): the label must SHRINK — its nowrap min-content
                was one of the floors that made the topbar wider than a phone
                viewport. Ellipsize instead of propping the row open. */}
            <span
                style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                Search tasks, lists…
            </span>
        </button>
    );
};
