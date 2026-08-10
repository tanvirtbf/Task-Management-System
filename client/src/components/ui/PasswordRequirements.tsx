import { Check, X } from "lucide-react";
import { PASSWORD_RULES } from "../../lib/passwordPolicy";
import { tokens } from "../../theme";

interface PasswordRequirementsProps {
    password: string;
    /**
     * Keep every rule muted until the person starts typing, so an untouched
     * form is not a wall of red crosses.
     */
    idleUntilTyped?: boolean;
}

/**
 * The live rule checklist shown next to every "choose a password" field.
 *
 * This REPLACED a strength meter that scored passwords "Weak…Very strong".
 * A score is not an answer to the only question being asked — "will this be
 * accepted?" — and it read green while the server refused the value, which is
 * why people could not get past the invitation page. Each line here is one
 * rule the API actually enforces (`lib/passwordPolicy.ts` mirrors the server),
 * so all four ticks means accepted.
 */
export const PasswordRequirements = ({
    password,
    idleUntilTyped = true,
}: PasswordRequirementsProps) => {
    const idle = idleUntilTyped && password.length === 0;

    return (
        <ul
            aria-label="Password requirements"
            style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
            }}
        >
            {PASSWORD_RULES.map((rule) => {
                const ok = rule.test(password);
                const color = idle
                    ? tokens.colors.textMuted
                    : ok
                      ? tokens.colors.success
                      : tokens.colors.danger;
                return (
                    <li
                        key={rule.id}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: tokens.typography.fontSize.xs,
                            color,
                        }}
                    >
                        {ok ? (
                            <Check size={13} strokeWidth={2.5} aria-hidden />
                        ) : (
                            <X size={13} strokeWidth={2.5} aria-hidden />
                        )}
                        <span>{rule.label}</span>
                        {/* Screen readers get the state as words, not colour. */}
                        <span
                            style={{
                                position: "absolute",
                                width: 1,
                                height: 1,
                                overflow: "hidden",
                                clip: "rect(0 0 0 0)",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {ok ? " — met" : " — not met yet"}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
};
