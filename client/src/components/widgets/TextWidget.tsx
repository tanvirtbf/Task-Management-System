import { tokens } from "../../theme";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
}

/**
 * Lightweight markdown renderer — supports headings (#/##/###), bold **x**,
 * italic *x*, lists (- or *), and paragraphs. No external dep.
 */
const renderMarkdown = (md: string): React.ReactNode => {
    const lines = md.split("\n");
    const out: React.ReactNode[] = [];
    let listBuffer: string[] = [];

    const flushList = () => {
        if (listBuffer.length > 0) {
            out.push(
                <ul
                    key={`ul-${out.length}`}
                    style={{
                        margin: "4px 0 8px",
                        paddingLeft: 18,
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    {listBuffer.map((item, i) => (
                        <li
                            key={i}
                            dangerouslySetInnerHTML={{
                                __html: inline(item),
                            }}
                        />
                    ))}
                </ul>,
            );
            listBuffer = [];
        }
    };

    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("### ")) {
            flushList();
            out.push(
                <h4
                    key={i}
                    style={{
                        margin: "8px 0 4px",
                        fontSize: tokens.typography.fontSize.base,
                        fontWeight: 600,
                    }}
                    dangerouslySetInnerHTML={{
                        __html: inline(trimmed.slice(4)),
                    }}
                />,
            );
        } else if (trimmed.startsWith("## ")) {
            flushList();
            out.push(
                <h3
                    key={i}
                    style={{
                        margin: "8px 0 6px",
                        fontSize: tokens.typography.fontSize.lg,
                        fontWeight: 700,
                    }}
                    dangerouslySetInnerHTML={{
                        __html: inline(trimmed.slice(3)),
                    }}
                />,
            );
        } else if (trimmed.startsWith("# ")) {
            flushList();
            out.push(
                <h2
                    key={i}
                    style={{
                        margin: "8px 0 8px",
                        fontSize: tokens.typography.fontSize.xl,
                        fontWeight: 700,
                    }}
                    dangerouslySetInnerHTML={{
                        __html: inline(trimmed.slice(2)),
                    }}
                />,
            );
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            listBuffer.push(trimmed.slice(2));
        } else if (trimmed) {
            flushList();
            out.push(
                <p
                    key={i}
                    style={{
                        margin: "0 0 6px",
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textSecondary,
                        lineHeight: 1.55,
                    }}
                    dangerouslySetInnerHTML={{ __html: inline(trimmed) }}
                />,
            );
        }
    });
    flushList();
    return out;
};

const inline = (s: string): string =>
    s
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");

export const TextWidget = ({ widget }: Props) => {
    const body =
        (widget.config.bodyMarkdown as string) ||
        "*Empty text widget — edit to add content.*";
    return (
        <div
            style={{
                padding: tokens.spacing[3],
                overflow: "auto",
                height: "100%",
            }}
        >
            {renderMarkdown(body)}
        </div>
    );
};
