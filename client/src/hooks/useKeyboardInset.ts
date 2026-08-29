import { useEffect, useState } from "react";

/**
 * P3 of MOBILE_REBUILD_PLAN.md — the on-screen keyboard.
 *
 * A phone keyboard does not resize the layout viewport; it shrinks the *visual*
 * viewport and leaves `position: fixed` elements sitting underneath it. Without
 * this, the bottom tab bar would cover the field you are typing into — the
 * classic mobile bug, and the one that lands on the two flows that matter most
 * here: sending a comment and submitting the create sheet.
 *
 * The hook publishes the keyboard's height as `--kb-inset` on the root element
 * so CSS can react without re-rendering React, and returns a boolean for the
 * structural decision (hide the tab bar entirely while typing — a phone screen
 * with a keyboard open has no room to spare, and every tab is one tap away
 * again the moment the field is dismissed).
 *
 * `visualViewport` is absent in a few older browsers; there the inset stays 0
 * and the bar simply never hides, which is the pre-P3 behaviour rather than a
 * broken one.
 */
const OPEN_THRESHOLD = 120; // px — smaller insets are toolbars, not keyboards

export const useKeyboardInset = (): boolean => {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;

        const update = () => {
            const inset = Math.max(
                0,
                window.innerHeight - vv.height - vv.offsetTop,
            );
            document.documentElement.style.setProperty(
                "--kb-inset",
                `${Math.round(inset)}px`,
            );
            setOpen(inset > OPEN_THRESHOLD);
        };

        update();
        vv.addEventListener("resize", update);
        vv.addEventListener("scroll", update);
        return () => {
            vv.removeEventListener("resize", update);
            vv.removeEventListener("scroll", update);
            document.documentElement.style.removeProperty("--kb-inset");
        };
    }, []);

    return open;
};
