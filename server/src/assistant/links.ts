/**
 * LINK SAFETY for the assistant's replies (deep-plan P3).
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 * Every address in this app is a RELATIVE path (`/t/abc`, `/inbox`), and the
 * widget turns a relative link into an in-app navigation. The model, however,
 * keeps inventing a domain in front of them — `https://beautybooth.com/t/abc`
 * — which is a website that does not exist. It was told not to, twice, in two
 * different places in the system prompt, and it still does it in roughly every
 * multi-task answer.
 *
 * So this is not left to the prompt. A link is rewritten on the way out:
 * `](https://anything/t/abc)` becomes `](/t/abc)`. Deterministic, cheap, and
 * it covers every tool that will ever return a url — not just the ones that
 * existed when the rule was written.
 *
 * ── ONLY OUR OWN PATHS ──────────────────────────────────────────────────────
 * The rewrite fires only when the path is one this app actually serves, so a
 * genuinely external link (should the KB ever carry one) is left alone.
 *
 * ── WHY THE STREAM NEEDS A BUFFER ───────────────────────────────────────────
 * The reply is streamed token by token, so a link arrives in pieces —
 * `](htt`, `ps://beauty`, `booth.com/t/ab`, `c)`. Rewriting each delta on its
 * own would never see a whole link. `LinkSafeStream` therefore holds back only
 * the text that could still be part of an unfinished link target and releases
 * everything else immediately, so the user still sees the answer appear as it
 * is written.
 */

/** Path prefixes this app really serves (see `client/src/router.tsx`). */
const APP_PATHS = [
    "t/",
    "s/",
    "inbox",
    "search",
    "dept",
    "reports",
    "sla",
    "forms",
    "eng",
    "settings",
    "login",
    "forgot-password",
].join("|");

/** `](https://host/t/abc)` → captures the origin and the path separately. */
const ABSOLUTE_APP_LINK = new RegExp(
    `\\]\\((?:https?:)?//[^)\\s/]+(/(?:${APP_PATHS})[^)\\s]*)\\)`,
    "gi",
);

/** Strip the invented origin from any link that points at one of our pages. */
export const relativizeAppLinks = (text: string): string =>
    text.replace(ABSOLUTE_APP_LINK, "]($1)");

/**
 * Streaming-safe applier of `relativizeAppLinks`.
 *
 * `push` returns the text that is safe to emit NOW; anything that might be a
 * half-arrived link target stays buffered until `push` completes it or
 * `flush` gives up on it (end of stream).
 */
export class LinkSafeStream {
    private pending = "";

    push(delta: string): string {
        this.pending += delta;
        let out = "";

        for (;;) {
            const open = this.pending.indexOf("](");
            if (open === -1) {
                // A trailing "]" could still become "](", so hold just that.
                const keep = this.pending.endsWith("]") ? 1 : 0;
                out += this.pending.slice(0, this.pending.length - keep);
                this.pending = this.pending.slice(this.pending.length - keep);
                break;
            }
            const close = this.pending.indexOf(")", open);
            if (close === -1) {
                // Link target still arriving — emit everything before it.
                out += this.pending.slice(0, open);
                this.pending = this.pending.slice(open);
                break;
            }
            out +=
                this.pending.slice(0, open) +
                relativizeAppLinks(this.pending.slice(open, close + 1));
            this.pending = this.pending.slice(close + 1);
        }

        return out;
    }

    /** Whatever is left when the stream ends (an unclosed link stays as-is). */
    flush(): string {
        const rest = relativizeAppLinks(this.pending);
        this.pending = "";
        return rest;
    }
}
