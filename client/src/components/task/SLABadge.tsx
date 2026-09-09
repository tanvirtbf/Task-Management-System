import { Tooltip } from "antd";
import { AlertTriangle, Clock, ShieldCheck } from "lucide-react";
import { tokens } from "../../theme";
import { humanGap } from "../../lib/deadline";
import { useNow } from "../../lib/now-tick";

/**
 * The SLA badge — a RESPONSE commitment, which is not the deadline.
 *
 * ── ⛔ decision §B4 lives here and in `DeadlineBadge` together ───────────────
 * A task can carry both an SLA target and a deadline, and they mean different
 * things: the SLA is how fast someone must respond, the deadline is when the
 * work is due. Two similar-looking countdowns on one screen without a word
 * saying which is which is the exact failure §B4 names. Three things keep them
 * apart, and all three are asserted in `SLABadge.test.tsx`:
 *
 *   1. **This one always says "SLA".** The deadline badge says "Deadline" only
 *      where the two can meet (the detail drawer), because on a card under the
 *      task name there is nothing to confuse it with and the user asked for
 *      *"17 hours baki"*, not a label.
 *   2. **Different icon families.** Shield and warning-triangle here; timer and
 *      circle there.
 *   3. **They count in the SAME units** (`humanGap`), deliberately. Making the
 *      numbers differ would not distinguish the badges, it would just make one
 *      of them harder to read.
 *
 * ── two defects P4 exposed by contrast, fixed here ──────────────────────────
 * Both were measured before being changed, in the characterisation block of
 * this component's test file:
 *
 *   - **It did not tick.** `now` was computed at render, so a page left open
 *     showed a frozen SLA beside a live deadline — the two disagreeing about
 *     the present is worse than either being wrong alone. It now reads the same
 *     shared clock (`lib/now-tick.ts`), which is still ONE interval for the
 *     page however many badges are on it.
 *   - **A breached task kept counting after it was finished.** A task completed
 *     two hours late read "SLA breached 5h ago" and, a month on, "SLA breached
 *     30d ago" — stating that the SLA is being missed *right now*, about work
 *     that is done. A finished task states a settled fact: "SLA missed by 2h".
 *     That is the same rule the deadline badge follows with "done 5h late".
 */

interface Props {
    slaDueAt: string;
    completedAt?: string | null;
    size?: "sm" | "md";
}

export const SLABadge = ({ slaDueAt, completedAt, size = "md" }: Props) => {
    const now = useNow();
    const target = new Date(slaDueAt);
    const targetMs = target.getTime();

    const chip = (
        text: string,
        color: string,
        Icon: typeof Clock,
        title: string,
    ) => (
        <Tooltip title={title}>
            <span
                data-sla-badge
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: size === "sm" ? "1px 6px" : "2px 8px",
                    borderRadius: tokens.radius.md,
                    background: `${color}1A`,
                    color,
                    fontSize: size === "sm" ? 10 : 11,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                }}
            >
                <Icon size={size === "sm" ? 10 : 12} strokeWidth={2} />
                {text}
            </span>
        </Tooltip>
    );

    // ── finished: the answer is a fact about the past and must not move ──────
    if (completedAt) {
        const done = new Date(completedAt).getTime();
        if (!Number.isNaN(done)) {
            return done <= targetMs
                ? chip(
                      "SLA met",
                      tokens.colors.success,
                      ShieldCheck,
                      `SLA met — the target was ${target.toLocaleString()}`,
                  )
                : chip(
                      `SLA missed by ${humanGap(done - targetMs)}`,
                      tokens.colors.danger,
                      AlertTriangle,
                      `SLA target was ${target.toLocaleString()}`,
                  );
        }
    }

    // ── still open: a live countdown, refreshed once a minute ────────────────
    const remaining = targetMs - now;
    return remaining < 0
        ? chip(
              `SLA breached ${humanGap(-remaining)} ago`,
              tokens.colors.danger,
              AlertTriangle,
              `SLA target was ${target.toLocaleString()}`,
          )
        : chip(
              `SLA in ${humanGap(remaining)}`,
              tokens.colors.warning,
              Clock,
              `SLA target: ${target.toLocaleString()}`,
          );
};
