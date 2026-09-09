import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { NOW_TICK_INTERNALS, TICK_MS, useNow } from "./now-tick";

/**
 * P4 of DEADLINE_TIME_PLAN_2026-09-08 — one timer, whatever the row count.
 *
 * The plan's warning: *"a 500-task list must not mount 500 timers"*. The
 * obvious implementation — a `setInterval` inside the badge — does exactly
 * that, and nothing about the rendered output would reveal it. So the count is
 * asserted here directly, against the number of mounted consumers, because a
 * claim of O(1) that nobody checks stops being true the first time somebody
 * "simplifies" the store back into a hook.
 */

/** A consumer that does nothing but read the shared clock. */
const Consumer = () => <span>{useNow()}</span>;

const Many = ({ count }: { count: number }) => (
    <>
        {Array.from({ length: count }, (_, i) => (
            <Consumer key={i} />
        ))}
    </>
);

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("the clock is shared, not per-consumer", () => {
    it("runs NO timer when nothing is watching", () => {
        expect({
            running: NOW_TICK_INTERNALS.isRunning(),
            listeners: NOW_TICK_INTERNALS.listenerCount(),
        }).toEqual({ running: false, listeners: 0 });
    });

    it("500 consumers share ONE interval", () => {
        render(<Many count={500} />);
        expect({
            listeners: NOW_TICK_INTERNALS.listenerCount(),
            timers: vi.getTimerCount(),
        }).toEqual({ listeners: 500, timers: 1 });
    });

    it("one consumer costs the same one interval", () => {
        render(<Many count={1} />);
        expect(vi.getTimerCount()).toBe(1);
    });

    it("stops the interval when the last consumer unmounts", () => {
        // A list view that navigates away must not leave a timer behind
        // re-rendering nothing, forever.
        const { unmount } = render(<Many count={20} />);
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect({
            running: NOW_TICK_INTERNALS.isRunning(),
            listeners: NOW_TICK_INTERNALS.listenerCount(),
            timers: vi.getTimerCount(),
        }).toEqual({ running: false, listeners: 0, timers: 0 });
    });

    it("unmounting SOME consumers keeps the interval for the rest", () => {
        // Virtualisation unmounts rows as they scroll out of view; that must
        // not stop the clock for the rows still on screen.
        const { rerender } = render(<Many count={50} />);
        rerender(<Many count={5} />);
        expect({
            listeners: NOW_TICK_INTERNALS.listenerCount(),
            timers: vi.getTimerCount(),
        }).toEqual({ listeners: 5, timers: 1 });
    });
});

describe("the clock actually advances", () => {
    it("every consumer sees the new time after one tick", () => {
        const { container } = render(<Many count={3} />);
        const before = container.textContent;

        act(() => {
            vi.advanceTimersByTime(TICK_MS);
        });

        const after = container.textContent;
        expect(before).not.toBe(after);
        // All three agree — one clock, not three drifting ones.
        expect(new Set(after?.match(/\d+/g)).size).toBe(1);
    });

    it("does not re-render between ticks", () => {
        // The snapshot must be stable, or `useSyncExternalStore` would see a
        // new value on every check and loop.
        const { container } = render(<Many count={2} />);
        const before = container.textContent;
        act(() => {
            vi.advanceTimersByTime(TICK_MS - 1000);
        });
        expect(container.textContent).toBe(before);
    });
});
