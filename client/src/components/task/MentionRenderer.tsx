import { useUsers } from "../../hooks/useReferenceData";
import { tokens } from "../../theme";

/**
 * Render a plain-text body, transforming `@username` and `#TASK-123`
 * tokens into styled inline pills. Used by CommentsSection for the
 * read view (input still uses a textarea — autocomplete is a V2).
 */
export const MentionRenderer = ({ body }: { body: string }) => {
    const { data: users = [] } = useUsers();
    const parts = splitTokens(body);
    const matchUser = (handle: string) => {
        const lower = handle.toLowerCase();
        // Same resolution order the server uses: email local-part is the
        // unambiguous token the mention picker inserts; first name and raw id
        // keep older hand-typed comments rendering.
        return (
            users.find((u) => u.email.split("@")[0].toLowerCase() === lower) ??
            users.find((u) => u.firstName.toLowerCase() === lower) ??
            users.find((u) => u.id === handle)
        );
    };
    return (
        <span style={{ whiteSpace: "pre-wrap" }}>
            {parts.map((p, i) => {
                if (p.kind === "mention") {
                    const u = matchUser(p.value);
                    return (
                        <span
                            key={i}
                            style={{
                                background: tokens.colors.primarySubtle,
                                color: tokens.colors.primary,
                                padding: "1px 5px",
                                borderRadius: 3,
                                fontWeight: 600,
                                fontSize: "0.93em",
                            }}
                            title={
                                u
                                    ? `${u.firstName} ${u.lastName} (${u.email})`
                                    : `Unknown user @${p.value}`
                            }
                        >
                            @{u ? `${u.firstName} ${u.lastName}`.trim() : p.value}
                        </span>
                    );
                }
                if (p.kind === "task") {
                    return (
                        <span
                            key={i}
                            style={{
                                background: tokens.colors.bgMuted,
                                color: tokens.colors.textPrimary,
                                padding: "1px 5px",
                                borderRadius: 3,
                                fontFamily: tokens.typography.fontFamilyMono,
                                fontWeight: 600,
                                fontSize: "0.88em",
                            }}
                        >
                            #{p.value}
                        </span>
                    );
                }
                return <span key={i}>{p.value}</span>;
            })}
        </span>
    );
};

type Part = { kind: "text" | "mention" | "task"; value: string };

const splitTokens = (s: string): Part[] => {
    const out: Part[] = [];
    const re = /(@[a-zA-Z0-9_.-]+)|(#[A-Z]+-\d+)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
        if (m.index > last) out.push({ kind: "text", value: s.slice(last, m.index) });
        if (m[1]) out.push({ kind: "mention", value: m[1].slice(1) });
        else if (m[2]) out.push({ kind: "task", value: m[2].slice(1) });
        last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ kind: "text", value: s.slice(last) });
    return out;
};
