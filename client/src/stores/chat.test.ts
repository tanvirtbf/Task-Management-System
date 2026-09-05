import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../http/assistant", () => ({ streamChat: vi.fn() }));

import { streamChat } from "../http/assistant";
import { useChatStore } from "./chat";

const mockStream = vi.mocked(streamChat);

const reset = () =>
    useChatStore.setState({
        messages: [],
        error: null,
        isStreaming: false,
        conversationId: null,
    });

describe("chat store — error handling + retryLast (P9)", () => {
    beforeEach(() => {
        reset();
        mockStream.mockReset();
    });

    it("on failure: sets the error and drops the empty assistant placeholder", async () => {
        mockStream.mockRejectedValueOnce(new Error("সমস্যা"));
        await useChatStore.getState().sendMessage("hello");
        const s = useChatStore.getState();
        expect(s.error).toBe("সমস্যা");
        expect(s.isStreaming).toBe(false);
        expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    });

    it("retryLast re-runs the last user turn without duplicating it", async () => {
        mockStream.mockRejectedValueOnce(new Error("fail"));
        await useChatStore.getState().sendMessage("how do I create a task?");
        expect(useChatStore.getState().error).toBeTruthy();

        mockStream.mockImplementationOnce(async (p) => {
            p.onDelta("ঠিক আছে");
        });
        await useChatStore.getState().retryLast();

        const s = useChatStore.getState();
        expect(s.error).toBeNull();
        expect(mockStream).toHaveBeenCalledTimes(2);
        const users = s.messages.filter((m) => m.role === "user");
        expect(users).toHaveLength(1);
        expect(users[0].content).toBe("how do I create a task?");
        const last = s.messages[s.messages.length - 1];
        expect(last.role).toBe("assistant");
        expect(last.content).toBe("ঠিক আছে");
    });

    it("retryLast is a no-op while streaming", async () => {
        useChatStore.setState({ isStreaming: true });
        await useChatStore.getState().retryLast();
        expect(mockStream).not.toHaveBeenCalled();
    });
});

/**
 * KI-15 — the leak between people on a shared machine, and the fix's own tests.
 *
 * The hole was one unscoped localStorage key, `th-chat`. Signing out scrubbed
 * it, but nobody signs out: they close the tab. The next person to open the
 * widget on that machine rehydrated the previous person's conversation — and
 * because the store sends `messages` back as `history`, their first question
 * carried the previous person's text to the model as context.
 *
 * The fix (`6d9334a`) gives the thread an `ownerId` and drops it in `claimFor`
 * when that does not match whoever is signed in. It shipped with NO unit
 * coverage — the test-plan carried that gap forward to this phase, which is
 * this block. Every case here is a way the drop could silently stop happening.
 */
describe("chat store — claimFor, the shared-machine guard (KI-15)", () => {
    const thread = (over: Partial<ReturnType<typeof useChatStore.getState>>) =>
        useChatStore.setState({
            messages: [
                {
                    id: "m1",
                    role: "user",
                    content: "amar salary koto?",
                    createdAt: 1,
                },
            ],
            conversationId: "conv-1",
            error: null,
            isStreaming: false,
            isOpen: true,
            ownerId: null,
            ...over,
        });

    beforeEach(() => {
        reset();
        useChatStore.setState({ ownerId: null, isOpen: false });
        mockStream.mockReset();
    });

    it("drops a thread belonging to SOMEBODY ELSE, and claims it for the new user", () => {
        thread({ ownerId: "user-rina" });

        useChatStore.getState().claimFor("user-arif");

        const s = useChatStore.getState();
        expect(s.messages).toEqual([]);
        expect(s.conversationId).toBeNull();
        expect(s.ownerId).toBe("user-arif");
        // The widget must not spring open showing an empty box either — that
        // is how the previous person's thread announced itself.
        expect(s.isOpen).toBe(false);
    });

    it("drops an UNATTRIBUTABLE thread — one saved before ownerId existed", () => {
        // The upgrade case, and the one a naive fix misses: `ownerId === null`
        // must not be treated as "nobody owns it, so anybody may read it".
        thread({ ownerId: null });

        useChatStore.getState().claimFor("user-arif");

        expect(useChatStore.getState().messages).toEqual([]);
        expect(useChatStore.getState().ownerId).toBe("user-arif");
    });

    it("KEEPS the thread when the same person comes back", () => {
        // The other half: a guard that always clears would be private and
        // useless, and nobody would notice for weeks.
        thread({ ownerId: "user-arif" });

        useChatStore.getState().claimFor("user-arif");

        const s = useChatStore.getState();
        expect(s.messages).toHaveLength(1);
        expect(s.conversationId).toBe("conv-1");
        expect(s.isOpen).toBe(true);
    });

    it("does nothing on sign-OUT (null) — that is auth.ts's clear() to do", () => {
        thread({ ownerId: "user-arif" });

        useChatStore.getState().claimFor(null);

        // Deliberate: a null user here is the bootstrap gap between loading and
        // resolved, not a person. Clearing on it would wipe the thread on every
        // page load; the sign-out path calls clear() explicitly.
        expect(useChatStore.getState().messages).toHaveLength(1);
    });

    it("stops an in-flight stream when it drops a foreign thread", () => {
        // Otherwise the previous person's answer keeps arriving and appends
        // itself to the new person's empty thread.
        thread({ ownerId: "user-rina", isStreaming: true });

        useChatStore.getState().claimFor("user-arif");

        expect(useChatStore.getState().isStreaming).toBe(false);
        expect(useChatStore.getState().messages).toEqual([]);
    });

    it("clear() wipes the owner too — a scrubbed thread must not stay claimed", () => {
        thread({ ownerId: "user-arif" });

        useChatStore.getState().clear();

        const s = useChatStore.getState();
        expect(s.messages).toEqual([]);
        expect(s.conversationId).toBeNull();
        expect(s.ownerId).toBeNull();
    });

    it("PERSISTS ownerId — the whole fix depends on it surviving the reload", () => {
        // `partialize` decides what reaches localStorage. If ownerId were left
        // out, every reload would look unattributable, the guard would clear
        // every thread for everybody, and the bug would come back the moment
        // somebody 'fixed' that by trusting a null owner.
        const persisted = (
            useChatStore as unknown as {
                persist: { getOptions: () => { partialize?: (s: unknown) => unknown } };
            }
        ).persist.getOptions().partialize;
        expect(persisted).toBeTypeOf("function");

        thread({ ownerId: "user-arif" });
        const saved = persisted!(useChatStore.getState()) as Record<
            string,
            unknown
        >;
        expect(Object.keys(saved).sort()).toEqual([
            "conversationId",
            "messages",
            "ownerId",
        ]);
        expect(saved.ownerId).toBe("user-arif");
    });

    it("the history sent to the model is the CURRENT person's, never the dropped thread's", async () => {
        // The sharpest form of the bug: not what is displayed, but what is
        // transmitted. The previous person's questions went to the model as
        // `history` on the next person's very first message.
        thread({ ownerId: "user-rina" });
        useChatStore.getState().claimFor("user-arif");

        // `streamChat` resolves void and reports through its callbacks.
        mockStream.mockImplementationOnce(async ({ onDelta }) => {
            onDelta?.("ok");
        });
        await useChatStore.getState().sendMessage("amar kaj ki?");

        expect(mockStream).toHaveBeenCalledTimes(1);
        const arg = mockStream.mock.calls[0][0] as { history?: unknown[] };
        expect(arg.history).toEqual([]);
        expect(JSON.stringify(arg)).not.toContain("salary");
    });
});
