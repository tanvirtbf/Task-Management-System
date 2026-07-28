import { describe, expect, it } from "vitest";
import { pickSuggestions, SUGGESTIONS } from "./suggestions";
import type { SuggestionAudience } from "./suggestions";

/**
 * Starter questions — who is offered what (P7 of AI_ASSISTANT_PERFECT_PLAN.md
 * re-gated these on real permissions instead of the legacy role string).
 *
 * The rule these pin: never offer someone a question whose answer sends them to
 * a page they cannot open. A starter chip that leads to a refusal is worse than
 * no chip, because the bot is what a confused person turns to *after* the app
 * has already confused them once.
 */

const audience = (
    over: Partial<SuggestionAudience> = {},
): SuggestionAudience => ({
    canSeeDept: false,
    canManageRoles: false,
    ...over,
});

const DEPT_Q = "Department review আর weekly report কোথায়?";
const ROLES_Q = "কাউকে শুধু একটা department-এর access কীভাবে দেব?";

describe("pickSuggestions", () => {
    it("offers exactly the ungated questions to an ordinary member", () => {
        const plain = pickSuggestions(audience());
        const ungated = SUGGESTIONS.filter((s) => !s.show).map((s) => s.q);
        expect(plain).toEqual(ungated);
    });

    it("has a meaningful curated set (more than the old 4)", () => {
        expect(SUGGESTIONS.length).toBeGreaterThanOrEqual(7);
    });

    it("HIDES the Department question from someone who cannot reach it", () => {
        expect(pickSuggestions(audience())).not.toContain(DEPT_Q);
    });

    it("SHOWS the Department question to someone who can", () => {
        expect(pickSuggestions(audience({ canSeeDept: true }))).toContain(
            DEPT_Q,
        );
    });

    it("HIDES the roles question from someone who cannot manage roles", () => {
        // Seeing Department does not imply being able to edit roles — the two
        // gates are separate permissions and must not leak into each other.
        expect(pickSuggestions(audience({ canSeeDept: true }))).not.toContain(
            ROLES_Q,
        );
    });

    it("SHOWS the roles question to someone who can", () => {
        expect(pickSuggestions(audience({ canManageRoles: true }))).toContain(
            ROLES_Q,
        );
    });

    it("shows everything to someone who holds both", () => {
        const both = pickSuggestions(
            audience({ canSeeDept: true, canManageRoles: true }),
        );
        expect(both).toContain(DEPT_Q);
        expect(both).toContain(ROLES_Q);
        expect(both).toHaveLength(SUGGESTIONS.length);
    });

    it("every question is a non-empty Bangla string", () => {
        for (const s of SUGGESTIONS) {
            expect(s.q.trim().length).toBeGreaterThan(5);
            // Bengali script — these render verbatim as chips.
            expect(s.q).toMatch(/[ঀ-৿]/);
        }
    });
});
