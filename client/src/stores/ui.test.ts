import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./ui";

describe("ui store — assistant onboarding nudge (P8)", () => {
    beforeEach(() => {
        useUiStore.setState({ assistantNudgeSeen: false, favoriteIds: ["x"] });
    });

    it("starts un-seen; dismissAssistantNudge marks it seen", () => {
        expect(useUiStore.getState().assistantNudgeSeen).toBe(false);
        useUiStore.getState().dismissAssistantNudge();
        expect(useUiStore.getState().assistantNudgeSeen).toBe(true);
    });

    it("reset() (sign-out purge) clears user data but KEEPS the per-browser nudge flag", () => {
        useUiStore.getState().dismissAssistantNudge();
        useUiStore.getState().reset();
        expect(useUiStore.getState().assistantNudgeSeen).toBe(true); // per-browser
        expect(useUiStore.getState().favoriteIds).toEqual([]); // user data purged
    });
});
