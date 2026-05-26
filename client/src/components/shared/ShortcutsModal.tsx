import { Modal } from "antd";
import { tokens } from "../../theme";

interface Props {
    open: boolean;
    onClose: () => void;
}

type Shortcut = {
    keys: string[];
    description: string;
};

type ShortcutGroup = {
    title: string;
    shortcuts: Shortcut[];
};

const isMac =
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || "");

const cmd = isMac ? "⌘" : "Ctrl";

const GROUPS: ShortcutGroup[] = [
    {
        title: "Global",
        shortcuts: [
            { keys: [cmd, "K"], description: "Open command palette" },
            { keys: ["?"], description: "Show this help" },
            { keys: [cmd, "N"], description: "New task" },
            { keys: ["Esc"], description: "Close modal / palette" },
        ],
    },
    {
        title: "Navigation (g + letter)",
        shortcuts: [
            { keys: ["g", "h"], description: "Go to Home" },
            { keys: ["g", "i"], description: "Go to Inbox" },
            { keys: ["g", "s"], description: "Go to Search" },
            { keys: ["g", "d"], description: "Go to Dashboards" },
            { keys: ["g", "a"], description: "Go to Automations" },
            { keys: ["g", "t"], description: "Go to Templates" },
            { keys: ["g", "n"], description: "Go to Notepad" },
            { keys: ["g", "r"], description: "Go to Reminders" },
            { keys: ["g", "f"], description: "Go to Forms" },
            { keys: ["g", ","], description: "Go to Settings" },
        ],
    },
    {
        title: "List view",
        shortcuts: [
            { keys: ["j"], description: "Next task" },
            { keys: ["k"], description: "Previous task" },
            { keys: ["x"], description: "Toggle select" },
            { keys: ["e"], description: "Edit task" },
            { keys: ["c"], description: "Add comment" },
        ],
    },
    {
        title: "Editing",
        shortcuts: [
            { keys: [cmd, "Enter"], description: "Save / submit form" },
            { keys: [cmd, "S"], description: "Save current draft" },
            { keys: [cmd, "B"], description: "Bold (in text editors)" },
            { keys: [cmd, "I"], description: "Italic (in text editors)" },
        ],
    },
];

export const ShortcutsModal = ({ open, onClose }: Props) => (
    <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={720}
        title={null}
    >
        <div style={{ padding: "8px 0 16px" }}>
            <h3
                style={{
                    margin: 0,
                    fontSize: tokens.typography.fontSize.lg,
                    fontWeight: 700,
                }}
            >
                Keyboard shortcuts
            </h3>
            <p
                style={{
                    margin: 0,
                    marginTop: 2,
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textMuted,
                }}
            >
                Quickly navigate and act without the mouse.
            </p>
        </div>
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
            }}
        >
            {GROUPS.map((group) => (
                <div key={group.title}>
                    <div
                        style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: tokens.colors.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            marginBottom: 8,
                            paddingBottom: 4,
                            borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                        }}
                    >
                        {group.title}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}
                    >
                        {group.shortcuts.map((s, i) => (
                            <div
                                key={i}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                    fontSize:
                                        tokens.typography.fontSize.sm,
                                }}
                            >
                                <span
                                    style={{
                                        color: tokens.colors.textSecondary,
                                    }}
                                >
                                    {s.description}
                                </span>
                                <span style={{ display: "flex", gap: 4 }}>
                                    {s.keys.map((k, j) => (
                                        <span
                                            key={j}
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 2,
                                            }}
                                        >
                                            {j > 0 && (
                                                <span
                                                    style={{
                                                        color: tokens.colors
                                                            .textMuted,
                                                        fontSize: 10,
                                                    }}
                                                >
                                                    +
                                                </span>
                                            )}
                                            <kbd
                                                style={{
                                                    background:
                                                        tokens.colors.bgMuted,
                                                    border: `1px solid ${tokens.colors.border}`,
                                                    borderRadius: 4,
                                                    padding: "1px 6px",
                                                    fontSize: 11,
                                                    fontFamily:
                                                        tokens.typography
                                                            .fontFamilyMono,
                                                    color: tokens.colors
                                                        .textPrimary,
                                                    minWidth: 18,
                                                    textAlign: "center",
                                                }}
                                            >
                                                {k}
                                            </kbd>
                                        </span>
                                    ))}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    </Modal>
);
