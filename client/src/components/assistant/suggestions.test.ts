import { describe, it, expect } from "vitest";
import { SUGGESTIONS, pickSuggestions } from "./suggestions";

describe("pickSuggestions (P7 role-aware starter questions)", () => {
    it("always includes the base (non-dept) questions", () => {
        const base = SUGGESTIONS.filter((s) => !s.deptOnly).map((s) => s.q);
        const shown = pickSuggestions(false);
        for (const q of base) expect(shown).toContain(q);
    });

    it("HIDES the Department/Reports question when the user can't see it", () => {
        const dept = SUGGESTIONS.find((s) => s.deptOnly)!.q;
        expect(pickSuggestions(false)).not.toContain(dept);
    });

    it("SHOWS the Department/Reports question when canSeeDept", () => {
        const dept = SUGGESTIONS.find((s) => s.deptOnly)!.q;
        expect(pickSuggestions(true)).toContain(dept);
        expect(pickSuggestions(true).length).toBe(SUGGESTIONS.length);
    });

    it("has a meaningful curated set (more than the old 4)", () => {
        expect(SUGGESTIONS.length).toBeGreaterThanOrEqual(7);
    });
});
