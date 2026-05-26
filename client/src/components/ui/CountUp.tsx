import { useEffect, useRef, useState } from "react";

interface CountUpProps {
    /** Final numeric value. */
    value: number;
    /** Animation duration in ms. */
    duration?: number;
    /** Optional formatter (e.g., for currency). */
    format?: (n: number) => string;
}

/**
 * Animated count-up from 0 to `value` on mount.
 * Uses requestAnimationFrame with ease-out.
 */
export const CountUp = ({ value, duration = 700, format }: CountUpProps) => {
    const [display, setDisplay] = useState(0);
    const startRef = useRef<number | null>(null);
    const fromRef = useRef<number>(0);

    useEffect(() => {
        fromRef.current = display;
        startRef.current = null;

        let rafId: number;
        const step = (ts: number) => {
            if (startRef.current === null) startRef.current = ts;
            const elapsed = ts - startRef.current;
            const t = Math.min(1, elapsed / duration);
            // ease-out cubic
            const eased = 1 - Math.pow(1 - t, 3);
            const current = fromRef.current + (value - fromRef.current) * eased;
            setDisplay(current);
            if (t < 1) {
                rafId = requestAnimationFrame(step);
            } else {
                setDisplay(value);
            }
        };
        rafId = requestAnimationFrame(step);
        return () => cancelAnimationFrame(rafId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, duration]);

    if (format) return <>{format(display)}</>;
    return <>{Math.round(display).toLocaleString()}</>;
};
