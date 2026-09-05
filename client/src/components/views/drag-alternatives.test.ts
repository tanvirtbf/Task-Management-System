import { describe, it, expect } from "vitest";

/**
 * P11 §3 — every drag action needs a path that works without dragging.
 *
 * ~70% of this workspace works from a phone, and on a phone dragging does not
 * work here at all: dnd-kit is wired with `PointerSensor` and the draggables
 * never set `touch-action`, so the browser claims the gesture as a scroll and
 * the drag never starts. `mobile.css` D5 makes that explicit and hides the drag
 * handles so the app stops advertising an affordance it cannot honour.
 *
 * That decision is only safe while the claim beside it holds — *"every drag
 * action already has a non-drag path"*. P11 checked it and found one exception:
 * the form builder's palette added a field by drag only, so a phone could not
 * build a form at all, and no keyboard could reach the palette either.
 *
 * This is the guard for the next one. Any file that makes something draggable
 * must also give it a tap or keyboard route — asserted structurally, because a
 * list of "the four current drag surfaces" is exactly the kind of list that
 * rots (§A's hand-written reset lists, twice).
 */

const SOURCES = import.meta.glob("../../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

const FILES = Object.entries(SOURCES).filter(
    ([p]) => !/\.test\.tsx?$/.test(p),
);

/** Makes something draggable — the dnd-kit hooks that attach drag listeners. */
const MAKES_DRAGGABLE = /useDraggable\s*\(|useSortable\s*\(/;

/**
 * Offers a non-drag route to the same action. Deliberately broad: an `onClick`,
 * a keyboard handler, or an antd control that carries its own — what matters is
 * that SOMETHING here responds to a tap.
 */
const HAS_TAP_PATH = /onClick\s*=|onKeyDown\s*=|onPressEnter\s*=/;

describe("no drag-only action (P11 §3)", () => {
    it("finds the source tree (guards against a vacuous pass)", () => {
        expect(FILES.length).toBeGreaterThan(50);
        expect(
            FILES.some(([, src]) => MAKES_DRAGGABLE.test(src)),
            "no draggable found at all — the glob or the pattern is wrong, and " +
                "this file would then pass while proving nothing",
        ).toBe(true);
    });

    it("every file that makes something draggable also responds to a tap", () => {
        const dragOnly = FILES.filter(
            ([, src]) => MAKES_DRAGGABLE.test(src) && !HAS_TAP_PATH.test(src),
        ).map(([p]) => p);

        expect(
            dragOnly,
            "Drag does not work on touch in this app (mobile.css D5), so a " +
                "drag-only control is unusable for ~70% of this workspace and " +
                "unreachable by keyboard for everyone. Give it an onClick — the " +
                "form builder's palette is the worked example.\n" +
                dragOnly.join("\n"),
        ).toEqual([]);
    });

    it("the form builder palette specifically: drag, tap and keyboard all add a field", () => {
        // The one this rule was written for, pinned by name because its failure
        // mode was silent — the palette LOOKED interactive and did nothing.
        const [, src] =
            FILES.find(([p]) => p.endsWith("forms/FormBuilderPage.tsx")) ?? [];
        expect(src, "FormBuilderPage.tsx not found").toBeTruthy();
        expect(src).toMatch(/const addField\s*=/);
        expect(src).toMatch(/onClick=\{add\}/);
        expect(src).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
        // …and the drag path still routes through the same function, so the two
        // cannot drift apart.
        expect(src).toMatch(/addField\(String\(active\.id\)/);
    });
});
