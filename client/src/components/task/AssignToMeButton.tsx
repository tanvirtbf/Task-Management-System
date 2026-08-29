import { Tooltip } from "antd";
import { Check } from "lucide-react";
import { useAssignablePeople } from "../../hooks/useAssignablePeople";
import { tokens } from "../../theme";

/**
 * "Me" — take this task, in one click.
 *
 * Assigning yourself is by far the most common assignment, and until now it
 * cost the same as assigning anyone else: open the picker, then find yourself
 * in a list of ~100 people. This sits next to the assignee control so the
 * common case never opens a menu at all.
 *
 * It is a TOGGLE, not a one-way door. A button that silently does nothing when
 * you are already assigned is a puzzle, so once you are on the task it shows a
 * tick and clicking again takes you off. The tooltip says so before you click.
 *
 * `useAssignablePeople` decides whether "me" exists: the signed-in user has to
 * be an ACTIVE member, because the server rejects anyone else with a 422. In
 * the vanishingly rare case they are not, the button renders nothing rather
 * than offering an action that would fail.
 */
export const AssignToMeButton = ({
    assigneeIds,
    onChange,
    size = "sm",
    pending = false,
}: {
    assigneeIds: string[];
    onChange: (next: string[]) => void;
    /** `md` is for the task sheet header; `sm` sits inline beside avatars. */
    size?: "sm" | "md";
    /**
     * True while the write is in flight. The button reads its state from
     * `assigneeIds`, which only catches up after the refetch — so a second
     * click landing in that window computed its toggle from stale data and
     * re-ADDED instead of removing. Locking it shut for the duration is
     * both the correct feedback and the fix.
     */
    pending?: boolean;
}) => {
    // `false` — this button never needs the team directory, so it must not be
    // the thing that fetches it on every task row that renders one.
    const { me } = useAssignablePeople(false);
    if (!me) return null;

    const assigned = assigneeIds.includes(me.id);
    const toggle = () =>
        onChange(
            assigned
                ? assigneeIds.filter((id) => id !== me.id)
                : [...assigneeIds, me.id],
        );

    return (
        <Tooltip
            title={
                assigned
                    ? "You're assigned — click to remove yourself"
                    : "Assign this task to yourself"
            }
        >
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (!pending) toggle();
                }}
                disabled={pending}
                aria-pressed={assigned}
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    height: size === "md" ? 28 : 22,
                    padding: size === "md" ? "0 10px" : "0 8px",
                    borderRadius: tokens.radius.full,
                    border: `1px solid ${
                        assigned ? tokens.colors.primary : tokens.colors.border
                    }`,
                    background: assigned
                        ? tokens.colors.primarySubtle
                        : "transparent",
                    color: assigned
                        ? tokens.colors.primary
                        : tokens.colors.textSecondary,
                    fontSize: size === "md" ? 12 : 11,
                    fontWeight: 600,
                    cursor: pending ? "wait" : "pointer",
                    opacity: pending ? 0.6 : 1,
                    whiteSpace: "nowrap",
                    transition: "background var(--transition-base)",
                }}
                onMouseEnter={(e) => {
                    if (!assigned)
                        e.currentTarget.style.background =
                            tokens.colors.bgHover;
                }}
                onMouseLeave={(e) => {
                    if (!assigned)
                        e.currentTarget.style.background = "transparent";
                }}
            >
                {assigned && <Check size={11} strokeWidth={2.5} />}
                Me
            </button>
        </Tooltip>
    );
};
