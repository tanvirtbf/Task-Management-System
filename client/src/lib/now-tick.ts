import { useSyncExternalStore } from "react";

/**
 * ONE clock for the whole page.
 *
 * `SLABadge` reads `new Date()` at render, so a page left open never updates —
 * a badge that said "2h left" at lunch still says it at six. For "17h left"
 * that is survivable; for "4m left" it is simply wrong, and this feature exists
 * to hand people hourly deadlines.
 *
 * ── ⛔ why this is a store and not a `useEffect` in the badge ────────────────
 * The obvious fix is a `setInterval` inside `DeadlineBadge`. That mounts one
 * timer PER ROW, and the list view renders hundreds — P13 measured 22,826 DOM
 * nodes before virtualisation, and a timer each would be worse than the nodes
 * were. Every subscriber here shares a single interval: it starts on the first
 * subscription and is cleared on the last, so a screen with no deadlines on it
 * runs no timer at all. `tests` assert that count directly, because "it is
 * O(1)" is exactly the kind of claim that rots.
 *
 * `useSyncExternalStore` rather than state-in-a-context: no provider to thread
 * through the tree, no re-render of anything that is not actually reading the
 * clock, and React handles the subscribe/unsubscribe lifecycle.
 */

/**
 * One minute. The badge's coarsest unit is the minute, so a faster tick would
 * re-render every row to produce identical text.
 */
export const TICK_MS = 60_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Snapshotted rather than read live, because `useSyncExternalStore` compares
 * the snapshot by identity to decide whether to re-render. Returning
 * `Date.now()` would return a new number on every check and loop forever.
 */
let snapshot = Date.now();

const tick = (): void => {
    snapshot = Date.now();
    for (const l of listeners) l();
};

const subscribe = (onStoreChange: () => void): (() => void) => {
    listeners.add(onStoreChange);
    if (timer === null) {
        // The first subscriber may have mounted most of a minute into the
        // current tick, so refresh immediately rather than showing a stale
        // number until the interval first fires.
        snapshot = Date.now();
        timer = setInterval(tick, TICK_MS);
    }
    return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0 && timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };
};

const getSnapshot = (): number => snapshot;

/**
 * The current time, refreshed once a minute, shared by every caller.
 *
 * Returns a millisecond timestamp rather than a `Date` so the snapshot compares
 * by value.
 */
export const useNow = (): number =>
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/**
 * What the tests look at. A component must never call these: the point of the
 * module is that nothing outside it knows there is a timer.
 */
export const NOW_TICK_INTERNALS = {
    listenerCount: (): number => listeners.size,
    isRunning: (): boolean => timer !== null,
    /** Advance the shared clock without waiting a minute. */
    forceTick: (): void => tick(),
};
