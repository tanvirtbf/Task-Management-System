import { useState } from "react";
import { App as AntApp, Checkbox } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { engineeringApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
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
 * Postmortem checklist for resolved Incident tasks — server-persisted via
 * GET/POST /eng/incidents/:id/postmortem (gap-scan H5: this used to live in
 * sessionStorage only, invisible to teammates). The parent mounts it with
 * `key={taskId}` so state resets per task. Server truth + a local overlay
 * for the just-clicked toggle; the overlay is dropped on error (revert).
 */
export const PostmortemChecklist = ({ taskId }: Props) => {
    const { message } = AntApp.useApp();
    const queryClient = useQueryClient();
    const [overlay, setOverlay] = useState<Record<string, boolean> | null>(
        null,
    );

    const query = useQuery({
        queryKey: ["postmortem", taskId],
        queryFn: () => engineeringApi.getPostmortem(taskId),
    });
    const save = useMutation({
        mutationFn: (items: Record<string, boolean>) =>
            engineeringApi.savePostmortem(taskId, items),
        onError: (err) => {
            setOverlay(null); // revert to server truth
            message.error(getApiErrorMessage(err));
        },
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: ["postmortem", taskId],
            });
        },
    });

    const items = overlay ?? query.data ?? {};

    const toggle = (label: string) => {
        const next = { ...items, [label]: !items[label] };
        setOverlay(next);
        save.mutate(next);
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
                        disabled={query.isLoading}
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
