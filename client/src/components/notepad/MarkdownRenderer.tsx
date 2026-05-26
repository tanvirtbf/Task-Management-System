import { tokens } from "../../theme";

/**
 * Lightweight markdown renderer — headings, bold, italic, lists, code, links.
 * Same engine used by the Text widget in dashboards.
 */
export const MarkdownRenderer = ({ markdown }: { markdown: string }) => {
    const lines = markdown.split("\n");
    const out: React.ReactNode[] = [];
    let listBuffer: string[] = [];
    let inCodeBlock = false;
    let codeBuffer: string[] = [];

    const flushList = () => {
        if (listBuffer.length > 0) {
            out.push(
                <ul
                    key={`ul-${out.length}`}
                    style={{
                        margin: "4px 0 8px",
                        paddingLeft: 20,
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    {listBuffer.map((item, i) => (
                        <li
                            key={i}
                            style={{ marginBottom: 2 }}
                            dangerouslySetInnerHTML={{ __html: inline(item) }}
                        />
                    ))}
                </ul>,
            );
            listBuffer = [];
        }
    };
    const flushCode = () => {
        if (codeBuffer.length > 0) {
            out.push(
                <pre
                    key={`code-${out.length}`}
                    style={{
                        margin: "8px 0",
                        background: tokens.colors.bgMuted,
                        padding: 10,
                        borderRadius: tokens.radius.md,
                        fontFamily: tokens.typography.fontFamilyMono,
                        fontSize: 12,
                        lineHeight: 1.4,
                        overflow: "auto",
                        border: `1px solid ${tokens.colors.borderSubtle}`,
                    }}
                >
                    <code>{codeBuffer.join("\n")}</code>
                </pre>,
            );
            codeBuffer = [];
        }
    };

    lines.forEach((line, i) => {
        if (line.trim().startsWith("```")) {
            if (inCodeBlock) {
                flushCode();
                inCodeBlock = false;
            } else {
                flushList();
                inCodeBlock = true;
            }
            return;
        }
        if (inCodeBlock) {
            codeBuffer.push(line);
            return;
        }

        const trimmed = line.trim();
        if (trimmed.startsWith("### ")) {
            flushList();
            out.push(
                <h4
                    key={i}
                    style={{
                        margin: "12px 0 4px",
                        fontSize: tokens.typography.fontSize.base,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                    }}
                    dangerouslySetInnerHTML={{ __html: inline(trimmed.slice(4)) }}
                />,
            );
        } else if (trimmed.startsWith("## ")) {
            flushList();
            out.push(
                <h3
                    key={i}
                    style={{
                        margin: "16px 0 6px",
                        fontSize: tokens.typography.fontSize.lg,
                        fontWeight: 700,
                        color: tokens.colors.textPrimary,
                    }}
                    dangerouslySetInnerHTML={{ __html: inline(trimmed.slice(3)) }}
                />,
            );
        } else if (trimmed.startsWith("# ")) {
            flushList();
            out.push(
                <h2
                    key={i}
                    style={{
                        margin: "20px 0 8px",
                        fontSize: tokens.typography.fontSize.xl,
                        fontWeight: 700,
                        color: tokens.colors.textPrimary,
                    }}
                    dangerouslySetInnerHTML={{ __html: inline(trimmed.slice(2)) }}
                />,
            );
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            listBuffer.push(trimmed.slice(2));
        } else if (/^\d+\.\s/.test(trimmed)) {
            listBuffer.push(trimmed.replace(/^\d+\.\s/, ""));
        } else if (trimmed === "") {
            flushList();
        } else {
            flushList();
            out.push(
                <p
                    key={i}
                    style={{
                        margin: "0 0 8px",
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textSecondary,
                        lineHeight: 1.6,
                    }}
                    dangerouslySetInnerHTML={{ __html: inline(trimmed) }}
                />,
            );
        }
    });
    flushList();
    flushCode();
    return <div>{out}</div>;
};

const inline = (s: string): string => {
    let out = s;
    // escape HTML first
    out = out
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    // bold
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // italic
    out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
    // code
    out = out.replace(
        /`([^`]+)`/g,
        `<code style="background:#F1F5F9;padding:1px 5px;border-radius:3px;font-family:inherit;font-size:0.9em;">$1</code>`,
    );
    // links
    out = out.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        `<a href="$2" target="_blank" style="color:#4F46E5;text-decoration:underline;">$1</a>`,
    );
    return out;
};
