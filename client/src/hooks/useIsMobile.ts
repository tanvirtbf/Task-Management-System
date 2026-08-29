import { useEffect, useState } from "react";

/**
 * D1/D2 of MOBILE_REBUILD_PLAN.md — the one place that decides "is this a phone".
 *
 * 768px is the line: below it there is no sidebar at all and the mobile shell
 * takes over; at and above it the desktop app is untouched.
 *
 * ⚠️ Use this for STRUCTURAL choices only — which component renders. Anything
 * cosmetic (sizes, spacing, font sizes, tap targets) belongs in
 * `src/mobile.css`, inside the same `@media (max-width: 767px)` query. Two
 * sources of truth for "looks like a phone" is how a codebase ends up with 140
 * components each inventing their own breakpoint, which is exactly the state
 * this rebuild is digging out of.
 */
export const MOBILE_MAX = 767;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX}px)`;

export const useIsMobile = (): boolean => {
    const [isMobile, setIsMobile] = useState(
        () => window.matchMedia(MOBILE_QUERY).matches,
    );

    useEffect(() => {
        const mq = window.matchMedia(MOBILE_QUERY);
        const update = () => setIsMobile(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);

    return isMobile;
};
