import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { InlineDateEdit } from "./InlineDateEdit";

/**
 * P3 of DEADLINE_TIME_PLAN_2026-09-08 — the inline editor, which is three of
 * the five surfaces (the list row, and both ends of the range in the task
 * properties panel).
 *
 * ── the thing that had to be MEASURED, not assumed ──────────────────────────
 * Decision §B5 says the time control is always visible. In a table row there is
 * no horizontal space for a second permanent control, so it rides in the
 * calendar dropdown's footer. That only works if the dropdown SURVIVES picking
 * a date — if antd closes the panel on select, the footer goes with it and the
 * time is unreachable without a second click on a control the user has just
 * finished using. This file is what settles that question against the real
 * component instead of against my reading of the docs.
 *
 * ── the other invariant ─────────────────────────────────────────────────────
 * Clearing the date clears the time, in ONE change. Two callbacks would mean
 * two PATCHes, and the state between them is the orphan the server refuses
 * (`task.time_without_date`).
 */

afterEach(cleanup);

/** Open the editor and hand back its calendar dropdown. */
const openEditor = (props: Partial<Parameters<typeof InlineDateEdit>[0]> = {}) => {
    const onChange = vi.fn();
    const { container } = render(
        <InlineDateEdit date={null} onChange={onChange} {...props} />,
    );
    const trigger = container.querySelector("button");
    if (trigger) fireEvent.click(trigger);
    return { onChange, container };
};

describe("the time control is reachable in the same pass as the date", () => {
    it("shows the time control as soon as the editor opens", () => {
        openEditor({ date: "2026-09-05" });
        expect(screen.getByText("Time")).toBeInTheDocument();
    });

    it("survives picking a date — the footer does not close with the panel", () => {
        // The measured question. A cell click selects a date; if the whole
        // dropdown unmounts, the time picker went with it.
        const { onChange } = openEditor({ date: "2026-09-05" });

        const cell = document.querySelector(
            ".ant-picker-cell-inner",
        ) as HTMLElement | null;
        expect(cell).not.toBeNull();
        fireEvent.click(cell!);

        expect(onChange).toHaveBeenCalled();
        expect(screen.queryByText("Time")).toBeInTheDocument();
    });

    it("is disabled until there is a date to hang it on", () => {
        openEditor({ date: null });
        const footer = screen.getByText("Time").parentElement as HTMLElement;
        expect(within(footer).getByRole("textbox")).toBeDisabled();
    });
});

describe("date and time are ONE edit", () => {
    it("clearing the date clears the time in a single change", () => {
        // Not two callbacks: the intermediate state between them is a time with
        // no date, which is exactly what the server refuses.
        const { onChange } = openEditor({ date: "2026-09-05", time: "17:00" });

        const clear = document.querySelector(
            ".ant-picker-clear",
        ) as HTMLElement | null;
        expect(clear).not.toBeNull();
        fireEvent.mouseDown(clear!);
        fireEvent.click(clear!);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toEqual({ date: null, time: null });
    });

    it("picking a time keeps the date it belongs to", () => {
        const { onChange } = openEditor({ date: "2026-09-05", time: null });

        const footer = screen.getByText("Time").parentElement as HTMLElement;
        const input = within(footer).getByRole("textbox");
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "5:00 PM" } });
        fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });

        expect(onChange).toHaveBeenCalled();
        expect(onChange.mock.calls.at(-1)?.[0]).toEqual({
            date: "2026-09-05",
            time: "17:00",
        });
    });

    it("the X beside the badge clears both halves too", () => {
        const onChange = vi.fn();
        const { container } = render(
            <InlineDateEdit
                date="2026-09-05"
                time="17:00"
                onChange={onChange}
            />,
        );
        // The badge is rendered closed; the X sits beside it.
        const x = container.querySelector("svg.lucide-x") as Element | null;
        expect(x).not.toBeNull();
        fireEvent.click(x!);

        expect(onChange).toHaveBeenCalledWith({ date: null, time: null });
    });
});
