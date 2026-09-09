import { Tooltip } from "antd";
import { AlertCircle, CheckCircle2, Timer } from "lucide-react";
import { tokens } from "../../theme";
import { describeDeadline, type DeadlineState } from "../../lib/deadline";
import { useNow } from "../../lib/now-tick";
import { useWorkspace } from "../../hooks/useReferenceData";

/**
 * "17h left" · "2d 13h left" · "5h late" · "done 5h late".
 *
 * P4 of DEADLINE_TIME_PLAN_2026-09-08 — the line the whole feature was asked
 * for. It sits under the task name, so somebody handed a task with an hourly
 * deadline can see how long they have without opening anything.
 *
 * ── the two things it must not do ───────────────────────────────────────────
 *  1. **Disagree with the server.** The maths is in `lib/deadline.ts`, checked
 *     against the server's rule across a matrix. This file only paints it.
 *  2. **Mount a timer.** It subscribes to ONE shared clock (`lib/now-tick.ts`).
 *     A `setInterval` here would be one per row on a list of hundreds.
 *
 * ── why it takes the zone from a hook and not a prop ────────────────────────
 * The deadline is a wall-clock reading in the WORKSPACE's zone, not the
 * viewer's. Threading that through every call site would mean five components
 * remembering to pass it and one of them eventually not — and the failure would
 * be silent and off by hours. `useWorkspace` is a react-query read, so the
 * hundredth row costs a cache hit, not a request.
 */

interface Props {
    dueDate: string | null | undefined;
    dueTime?: string | null;
    completedAt?: string | null;
    size?: "sm" | "md";
}

/** Colour per state. Done-on-time is deliberately quiet — it is good news. */
const PALETTE: Record<
    Exclude<DeadlineState, "none">,
    { color: string; subtle: boolean }
> = {
    upcoming: { color: tokens.colors.textSecondary, subtle: true },
    soon: { color: tokens.colors.warning, subtle: false },
    late: { color: tokens.colors.danger, subtle: false },
    done_on_time: { color: tokens.colors.success, subtle: true },
    done_late: { color: tokens.colors.danger, subtle: true },
};

const ICON: Record<Exclude<DeadlineState, "none">, typeof Timer> = {
    upcoming: Timer,
    soon: Timer,
    late: AlertCircle,
    done_on_time: CheckCircle2,
    done_late: AlertCircle,
};

export const DeadlineBadge = ({
    dueDate,
    dueTime = null,
    completedAt = null,
    size = "sm",
}: Props) => {
    const now = useNow();
    const { data: workspace } = useWorkspace();
    // Until the workspace loads, fall back to the business default rather than
    // rendering nothing and then popping in — the same fallback the server's
    // zone helpers use for an unusable zone.
    const timeZone = workspace?.settings.timezone ?? "Asia/Dhaka";

    const { state, text, title } = describeDeadline({
        dueDate,
        dueTime,
        completedAt,
        timeZone,
        now,
    });

    if (state === "none") return null;

    const { color, subtle } = PALETTE[state];
    const Icon = ICON[state];
    const fontSize = size === "sm" ? 11 : 12;
    const iconSize = size === "sm" ? 11 : 12;

    return (
        <Tooltip title={`Deadline: ${title}`}>
            <span
                data-deadline-state={state}
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    padding: subtle ? 0 : "1px 6px",
                    borderRadius: tokens.radius.sm,
                    background: subtle ? "transparent" : `${color}1A`,
                    color,
                    fontSize,
                    fontWeight: subtle ? 400 : 600,
                    whiteSpace: "nowrap",
                }}
            >
                <Icon size={iconSize} strokeWidth={1.75} />
                {text}
            </span>
        </Tooltip>
    );
};
