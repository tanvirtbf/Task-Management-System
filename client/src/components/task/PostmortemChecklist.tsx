import { useState } from "react";
import { Checkbox } from "antd";
import { ClipboardCheck } from "lucide-react";
import { tokens } from "../../theme";

const DEFAULT_ITEMS = [
    "Timeline reconstructed",
    "Root cause identified",
    "Impact quantified (users / revenue / time)",
    "Customer comms sent",
    "Action items created (linked tasks)",
    "Lessons documented in runbook",
];

interface Props {
    taskId: string;
}

/**
 * Lightweight client-only postmortem checklist for Incident task types.
 * Persistence is in-memory only — backend will swap this out later.
 */
export const PostmortemChecklist = ({ taskId }: Props) => {
    const storageKey = `postmortem-${taskId}`;
    const [items, setItems] = useState<Record<string, boolean>>(() => {
        try {
            const raw = sessionStorage.getItem(storageKey);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    });

    const toggle = (label: string) => {
        const next = { ...items, [label]: !items[label] };
        setItems(next);
        try {
            sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
            /* ignore */
        }
    };

    const done = DEFAULT_ITEMS.filter((l) => items[l]).length;

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                background: "rgba(220, 38, 38, 0.04)",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: tokens.spacing[3],
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.danger,
                }}
            >
                <ClipboardCheck size={11} strokeWidth={1.75} />
                Post-mortem checklist
                <span
                    style={{
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {done}/{DEFAULT_ITEMS.length}
                </span>
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                }}
            >
                {DEFAULT_ITEMS.map((label) => (
                    <Checkbox
                        key={label}
                        checked={!!items[label]}
                        onChange={() => toggle(label)}
                    >
                        <span
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                textDecoration: items[label]
                                    ? "line-through"
                                    : "none",
                                color: items[label]
                                    ? tokens.colors.textMuted
                                    : tokens.colors.textPrimary,
                            }}
                        >
                            {label}
                        </span>
                    </Checkbox>
                ))}
            </div>
        </div>
    );
};
