import { useState } from "react";
import { ChevronDown, ChevronRight, UserCheck } from "lucide-react";
import { useTaskAssignmentRequests } from "../../hooks/useAssignmentRequests";
import { AssignmentRequestCard } from "./AssignmentRequestCard";
import { tokens } from "../../theme";

/**
 * The task drawer's approval panel (team-access P9): every pending
 * cross-team assignment request on THIS task, with the decided history
 * beneath it. Self-gating — renders nothing when the task has no
 * negotiation at all, so ordinary tasks pay zero pixels.
 */
export const AssignmentRequestsSection = ({ taskId }: { taskId: string }) => {
    const [collapsed, setCollapsed] = useState(false);
    const { data: requests = [] } = useTaskAssignmentRequests(taskId);

    if (requests.length === 0) return null;

    const pending = requests.filter((r) => r.status === "pending");
    const decided = requests.filter((r) => r.status !== "pending").slice(0, 3);

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <button
                onClick={() => setCollapsed(!collapsed)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "none",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    color: tokens.colors.textMuted,
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    width: "100%",
                }}
            >
                {collapsed ? (
                    <ChevronRight size={11} strokeWidth={2} />
                ) : (
                    <ChevronDown size={11} strokeWidth={2} />
                )}
                <UserCheck size={11} strokeWidth={1.75} />
                Assignment approval
                {pending.length > 0 && (
                    <span
                        style={{
                            marginLeft: 6,
                            color: "#92400E",
                            background: "#FEF3C7",
                            borderRadius: tokens.radius.full,
                            padding: "0 7px",
                            fontSize: 10,
                            fontWeight: 700,
                        }}
                    >
                        {pending.length} pending
                    </span>
                )}
            </button>

            {!collapsed && (
                <div
                    style={{
                        marginTop: tokens.spacing[2],
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    {pending.map((r) => (
                        <AssignmentRequestCard key={r.id} request={r} />
                    ))}
                    {decided.map((r) => (
                        <AssignmentRequestCard key={r.id} request={r} />
                    ))}
                </div>
            )}
        </div>
    );
};
