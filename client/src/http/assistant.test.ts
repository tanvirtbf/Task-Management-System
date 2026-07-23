import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the auth store + refresh helper so streamChat runs without real auth.
vi.mock("../stores/auth", () => ({
    useAuthStore: {
        getState: () => ({
            accessToken: "test-token",
            logout: vi.fn(),
            setAccessToken: vi.fn(),
        }),
    },
}));
vi.mock("./client", () => ({
    refreshAccessToken: vi.fn(),
    BASE_URL: "http://localhost:5501/api/v1",
}));

import { streamChat } from "./assistant";

/** Build a ReadableStream that emits the given SSE text chunks then closes. */
const sse = (chunks: string[]): ReadableStream<Uint8Array> => {
    const enc = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const c of chunks) controller.enqueue(enc.encode(c));
            controller.close();
        },
    });
};

const mockFetch = (body: ReadableStream<Uint8Array>, status = 200): void => {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        body,
        headers: { get: () => null }, // real fetch always supplies a Headers
        json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;
};

describe("streamChat (SSE parsing)", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("collects deltas and stops at [DONE]", async () => {
        mockFetch(
            sse([
                'data: {"delta":"Hello "}\n\n',
                'data: {"delta":"world"}\n\n',
                "data: [DONE]\n\n",
            ]),
        );
        const out: string[] = [];
        await streamChat({
            message: "hi",
            history: [],
            onDelta: (d) => out.push(d),
        });
        expect(out.join("")).toBe("Hello world");
    });

    it("reassembles a delta split across read chunks", async () => {
        mockFetch(sse(['data: {"del', 'ta":"Hi"}\n\n', "data: [DONE]\n\n"]));
        const out: string[] = [];
        await streamChat({
            message: "x",
            history: [],
            onDelta: (d) => out.push(d),
        });
        expect(out.join("")).toBe("Hi");
    });

    it("rejects with a friendly Bangla error on a mid-stream error event (suppresses the server's raw message)", async () => {
        mockFetch(
            sse([
                'data: {"error":"assistant.upstream_error","message":"boom"}\n\n',
            ]),
        );
        let caught: Error | null = null;
        try {
            await streamChat({
                message: "x",
                history: [],
                onDelta: () => undefined,
            });
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).toBeInstanceOf(Error);
        // Bangla reply (Bengali Unicode block), NOT the raw English "boom".
        expect(caught?.message).toMatch(/[ঀ-৿]/);
        expect(caught?.message).not.toContain("boom");
    });
});
