import { useMemo } from "react";
import { Tooltip } from "antd";
import { users } from "../../mocks/users";
import { tokens } from "../../theme";

/**
 * Renders plain text with `@firstname` style mentions resolved to a styled
 * chip. Match is case-insensitive against `firstName` and `firstName.lastName`.
 */
export const MentionRenderer = ({ text }: { text: string }) => {
    const lookup = useMemo(() => {
        const m = new Map<string, (typeof users)[number]>();
        users.forEach((u) => {
            m.set(u.firstName.toLowerCase(), u);
            m.set(
                `${u.firstName}.${u.lastName}`.toLowerCase(),
                u,
            );
            m.set(u.email.toLowerCase(), u);
        });
        return m;
    }, []);

    if (!text) return null;

    // Split text into segments: plain text + mentions
    const parts: React.ReactNode[] = [];
    const regex = /@([a-zA-Z0-9_.-]+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        const handle = match[1];
        const user = lookup.get(handle.toLowerCase());
        if (user) {
            parts.push(
                <MentionChip
                    key={`m-${key++}`}
                    name={`${user.firstName} ${user.lastName}`}
                    email={user.email}
                />,
            );
        } else {
            // Unknown mention — render as muted text
            parts.push(
                <span
                    key={`m-${key++}`}
                    style={{ color: tokens.colors.textMuted }}
                >
                    @{handle}
                </span>,
            );
        }
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
    return <>{parts}</>;
};

const MentionChip = ({ name, email }: { name: string; email: string }) => (
    <Tooltip title={email}>
        <span
            style={{
                display: "inline-flex",
                alignItems: "baseline",
                padding: "0 4px",
                margin: "0 1px",
                background: tokens.colors.primarySubtle,
                color: tokens.colors.primary,
                borderRadius: 3,
                fontWeight: 600,
                fontSize: "inherit",
                cursor: "default",
            }}
        >
            @{name.split(" ")[0]}
        </span>
    </Tooltip>
);
