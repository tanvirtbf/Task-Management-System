import { Search } from "lucide-react";
import { useUiStore } from "../../stores/ui";
import { tokens } from "../../theme";

/**
 * The visible "Search or jump to..." pill in the topbar.
 * Opens the command palette (rendered in Phase 11).
 */
export const CommandPaletteTrigger = () => {
    const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
    return (
        <button
            onClick={() => setOpen(true)}
            aria-label="Open command palette (Cmd K)"
            title="Search or jump to (Cmd K)"
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
            <Search size={14} strokeWidth={1.75} />
            <span style={{ flex: 1, textAlign: "left" }}>
                Search or jump to...
            </span>
            <kbd
                style={{
                    fontFamily: tokens.typography.fontFamilyMono,
                    fontSize: 10,
                    background: tokens.colors.bgMuted,
                    color: tokens.colors.textMuted,
                    padding: "1px 5px",
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: 4,
                }}
            >
                ⌘K
            </kbd>
        </button>
    );
};
