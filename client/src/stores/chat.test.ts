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
