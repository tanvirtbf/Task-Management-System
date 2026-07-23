import type { Components } from "react-markdown";
import type { NavigateFunction } from "react-router-dom";

/**
 * Assistant-answer link handling (AI_ASSISTANT_UPGRADE_PLAN.md P6 / gap F2).
 *
 * The help bot emits Markdown links to real app routes (e.g. `[Inbox](/inbox)`).
 * Before P6 every link opened a NEW browser tab that full-reloaded the whole
 * SPA — the opposite of a guided in-app hop. Now:
 *   - a same-origin relative path  → react-router `navigate()` (no reload)
 *   - an http(s) URL               → new tab (rel=noreferrer)
 *   - anything else                → plain text, never a live link (XSS-safe)
 */

export type LinkKind = "in-app" | "external" | "unsafe";

/**
 * Classify a link href. "in-app" is a single-leading-slash relative path we can
 * hand to the router; protocol-relative ("//host"), javascript:/data:/mailto:,
 * and empty hrefs are "unsafe" and rendered as plain text.
 */
export const classifyLink = (href: string | undefined): LinkKind => {
    if (!href) return "unsafe";
    if (/^\/(?!\/)/.test(href)) return "in-app";
    if (/^https?:\/\//i.test(href)) return "external";
    return "unsafe";
};

/**
 * Build the react-markdown component overrides for assistant messages.
 * `onInAppNavigate` runs after an in-app hop (the widget uses it to close on the
 * mobile full-screen sheet, so the user actually sees where they landed).
 */
export const makeAssistantMarkdownComponents = (
    navigate: NavigateFunction,
    onInAppNavigate: () => void,
): Components => ({
    a({ href, children }) {
        const kind = classifyLink(href);
        if (kind === "in-app") {
            return (
                <a
                    href={href}
                    onClick={(e) => {
                        e.preventDefault();
                        navigate(href as string);
                        onInAppNavigate();
                    }}
                >
                    {children}
                </a>
            );
        }
        if (kind === "external") {
            return (
                <a href={href} target="_blank" rel="noreferrer">
                    {children}
                </a>
            );
        }
        return <span>{children}</span>;
    },
});
