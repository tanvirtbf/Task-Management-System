import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { TimeOfDayPicker } from "./TimeOfDayPicker";
import { formatTimeOfDay } from "../../lib/date-utils";

/**
 * P3 of DEADLINE_TIME_PLAN_2026-09-08 — the always-visible time control.
 *
 * Two things here are load-bearing rather than cosmetic, and both would pass a
 * casual eye while being wrong:
 *
 *  1. **What it SENDS is 24-hour `HH:MM`, not what it SHOWS.** The user asked
 *     for AM/PM, and `"5:00 PM"` is one of the malformed values the server's
 *     validator refuses — pinned in `deadline-time.test.ts` for exactly this
 *     reason. A picker that displays and emits the same string is the single
 *     most likely way to reintroduce that 422.
 *  2. **Blank means end of day, not midnight (§B1).** The placeholder is the
 *     only place a person learns that, so it is asserted, not assumed.
 */

afterEach(cleanup);

const noop = () => {};

describe("what the picker SENDS is not what it SHOWS", () => {
    it("renders a 24-hour value as 12-hour with a meridiem", () => {
        render(
            <TimeOfDayPicker value="17:00" kind="due" hasDate onChange={noop} />,
        );
        expect(screen.getByRole("textbox")).toHaveValue("5:00 PM");
    });

    it("accepts the HH:MM:SS a TIME column hands back", () => {
        // mysql2 returns `17:00:00`; a task echoed straight from the API can
        // carry it. Parsing that as anything but 5 PM would blank the control.
        render(
            <TimeOfDayPicker
                value="17:00:00"
                kind="due"
                hasDate
                onChange={noop}
            />,
        );
        expect(screen.getByRole("textbox")).toHaveValue("5:00 PM");
    });

    it("emits HH:MM — never the 12-hour text on screen", () => {
        const onChange = vi.fn();
        render(
            <TimeOfDayPicker value={null} kind="due" hasDate onChange={onChange} />,
        );

        // Typed in the 12-hour shape the control displays — the exact input
        // whose naive echo is a 422.
        const input = screen.getByRole("textbox");
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "5:00 PM" } });
        fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });

        expect(onChange).toHaveBeenCalled();
        const sent = onChange.mock.calls.at(-1)?.[0];
        expect({ sent, matches24h: /^([01]\d|2[0-3]):[0-5]\d$/.test(sent) }).toEqual({
            sent: "17:00",
            matches24h: true,
        });
    });

    it("emits null when cleared, which is end of day and not midnight", () => {
        // The distinction the whole migration rests on. `"00:00"` here would
        // turn every cleared time into a midnight deadline.
        expect(formatTimeOfDay(null)).toBe("");
        expect(formatTimeOfDay("00:00")).toBe("12:00 AM");
    });
});

describe("blank says what blank MEANS", () => {
    it("a due time reads 'End of day', not --:--", () => {
        render(
            <TimeOfDayPicker value={null} kind="due" hasDate onChange={noop} />,
        );
        expect(screen.getByPlaceholderText("End of day")).toBeInTheDocument();
    });

    it("a start time reads 'Start of day' — the asymmetry is the point", () => {
        render(
            <TimeOfDayPicker value={null} kind="start" hasDate onChange={noop} />,
        );
        expect(screen.getByPlaceholderText("Start of day")).toBeInTheDocument();
    });
});

describe("a time cannot be picked without its date", () => {
    it("is disabled with no date, so the 422 is unreachable", () => {
        // The server refuses `task.time_without_date`. The UI should never let
        // someone compose that request and meet the refusal.
        render(
            <TimeOfDayPicker
                value={null}
                kind="due"
                hasDate={false}
                onChange={noop}
            />,
        );
        expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("is enabled once a date exists", () => {
        render(
            <TimeOfDayPicker value={null} kind="due" hasDate onChange={noop} />,
        );
        expect(screen.getByRole("textbox")).toBeEnabled();
    });
});

describe("formatTimeOfDay — the read-only rendering", () => {
    it("covers noon, midnight and the hours either side", () => {
        // The two that a naive `h % 12` gets wrong are 00:00 and 12:00: both
        // land on hour 0, and one of them is meant to read 12.
        expect([
            formatTimeOfDay("00:00"),
            formatTimeOfDay("00:30"),
            formatTimeOfDay("11:59"),
            formatTimeOfDay("12:00"),
            formatTimeOfDay("12:01"),
            formatTimeOfDay("13:05"),
            formatTimeOfDay("23:59"),
        ]).toEqual([
            "12:00 AM",
            "12:30 AM",
            "11:59 AM",
            "12:00 PM",
            "12:01 PM",
            "1:05 PM",
            "11:59 PM",
        ]);
    });

    it("returns nothing for absent or unparseable input", () => {
        expect([
            formatTimeOfDay(null),
            formatTimeOfDay(undefined),
            formatTimeOfDay(""),
            formatTimeOfDay("not a time"),
        ]).toEqual(["", "", "", ""]);
    });
});
