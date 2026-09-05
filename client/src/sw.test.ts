import { describe, expect, it, vi } from "vitest";
// Vite's `?raw` rather than `node:fs`: `tsconfig.app.json` pins `types` to
// vitest/jest-dom/vite-client, so a `node:` import does not type-check here even
// though it would run fine. This keeps the file inside the client's own toolchain.
import SW_SOURCE from "../public/sw.js?raw";

/**
 * `public/sw.js` — the service worker, exercised rather than read.
 *
 * It is the one file in the client nothing else checks: `eslint.config.js`
 * matches only `**\/*.{ts,tsx}`, it is copied verbatim out of `public/` rather
 * than bundled, and its globals (`self`, `caches`, `clients`) exist nowhere
 * else in the codebase. It is also the file that decides whether a person sees
 * yesterday's tasks, and whether the offline screen is telling the truth.
 *
 * So it gets a harness: a fake service-worker scope, the real file evaluated
 * inside it, and the handlers it registers driven by hand. What is asserted is
 * the reasoning in its own header — `/api/*` is never cached, hashed assets are
 * cache-first, navigations are network-first with the cache as a pure offline
 * fallback — because that reasoning is what a later edit will quietly break.
 */

interface FakeRequest {
    url: string;
    method: string;
    mode?: string;
}

interface FakeEvent {
    request?: FakeRequest;
    data?: { json: () => unknown } | null;
    notification?: { close: () => void; data?: { url?: string } };
    waitUntil: (p: unknown) => void;
    respondWith: (p: unknown) => void;
}

type Handler = (event: FakeEvent) => void;

const keyOf = (req: FakeRequest | string): string =>
    typeof req === "string" ? req : req.url;

type FetchImpl = () => Promise<{ ok: boolean }>;

class FakeCache {
    store = new Map<string, unknown>();
    fetchImpl: FetchImpl;
    // Explicit assignment rather than a parameter property: the client compiles
    // with `erasableSyntaxOnly`, which forbids the shorthand.
    constructor(fetchImpl: FetchImpl) {
        this.fetchImpl = fetchImpl;
    }
    async add(url: string): Promise<void> {
        const res = await this.fetchImpl();
        if (!res || !res.ok) throw new Error(`add failed: ${url}`);
        this.store.set(url, res);
    }
    async put(req: FakeRequest | string, res: unknown): Promise<void> {
        this.store.set(keyOf(req), res);
    }
    async match(req: FakeRequest | string): Promise<unknown> {
        return this.store.get(keyOf(req));
    }
}

class FakeCaches {
    opened = new Map<string, FakeCache>();
    fetchImpl: FetchImpl;
    constructor(fetchImpl: FetchImpl) {
        this.fetchImpl = fetchImpl;
    }
    async open(name: string): Promise<FakeCache> {
        let c = this.opened.get(name);
        if (!c) {
            c = new FakeCache(this.fetchImpl);
            this.opened.set(name, c);
        }
        return c;
    }
    async keys(): Promise<string[]> {
        return [...this.opened.keys()];
    }
    async delete(name: string): Promise<boolean> {
        return this.opened.delete(name);
    }
    async match(req: FakeRequest | string): Promise<unknown> {
        for (const c of this.opened.values()) {
            const hit = await c.match(req);
            if (hit) return hit;
        }
        return undefined;
    }
}

/** Let the worker's un-awaited `.then(c => c.put(...))` land before asserting. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Build a service-worker global scope and evaluate the real file inside it. */
const bootSw = () => {
    const handlers = new Map<string, Handler>();
    const fetchMock = vi.fn(async () => ({
        ok: true,
        fromNetwork: true,
        clone: () => ({ ok: true, fromNetwork: true }),
    }));
    const showNotification = vi.fn(async () => undefined);
    const claim = vi.fn(async () => undefined);
    const skipWaiting = vi.fn(async () => undefined);
    const openWindow = vi.fn(async () => undefined);
    const windows: Array<Record<string, unknown>> = [];

    const caches = new FakeCaches(
        fetchMock as unknown as () => Promise<{ ok: boolean }>,
    );

    const self = {
        addEventListener: (name: string, fn: Handler) => handlers.set(name, fn),
        skipWaiting,
        location: { origin: "https://tasks.example.com" },
        registration: { showNotification },
        clients: { claim, openWindow, matchAll: async () => windows },
    };

    const ResponseStub = { error: () => ({ type: "error" }) };

    // `new Function` rather than `node:vm`: the worker only needs these five
    // bindings, and shadowing them as parameters keeps the real `fetch` and
    // `Response` of the test environment out of reach.
    const factory = new Function(
        "self",
        "caches",
        "fetch",
        "URL",
        "Response",
        SW_SOURCE,
    );
    factory(self, caches, fetchMock, URL, ResponseStub);

    /** Fire a handler and resolve whatever it passed to waitUntil/respondWith. */
    const fire = async (name: string, event: Partial<FakeEvent> = {}) => {
        const handler = handlers.get(name);
        if (!handler) throw new Error(`no ${name} handler registered`);
        let waited: unknown;
        let responded: unknown;
        handler({
            ...event,
            waitUntil: (p: unknown) => {
                waited = p;
            },
            respondWith: (p: unknown) => {
                responded = p;
            },
        } as FakeEvent);
        await waited;
        const response = responded === undefined ? undefined : await responded;
        await settle();
        return { responded, response };
    };

    return {
        handlers,
        fire,
        caches,
        fetchMock,
        showNotification,
        claim,
        skipWaiting,
        openWindow,
        windows,
    };
};

const SHELL = "bb-shell-v1";
const req = (url: string, extra: Partial<FakeRequest> = {}): FakeRequest => ({
    url,
    method: "GET",
    ...extra,
});

describe("sw.js — registration", () => {
    it("registers exactly the five handlers the app depends on", () => {
        expect([...bootSw().handlers.keys()].sort()).toEqual([
            "activate",
            "fetch",
            "install",
            "notificationclick",
            "push",
        ]);
    });
});

describe("sw.js — install", () => {
    it("caches the app shell and takes over immediately", async () => {
        const sw = bootSw();
        await sw.fire("install");
        const cache = await sw.caches.open(SHELL);
        expect([...cache.store.keys()].sort()).toEqual([
            "/",
            "/apple-touch-icon.png",
            "/icon-192.png",
            "/icon.svg",
            "/manifest.webmanifest",
        ]);
        expect(sw.skipWaiting).toHaveBeenCalled();
    });

    it("survives one shell URL failing — a bad icon must not block the install", async () => {
        const sw = bootSw();
        sw.fetchMock.mockRejectedValueOnce(new Error("404"));
        await sw.fire("install");
        expect(sw.skipWaiting).toHaveBeenCalled();
        const cache = await sw.caches.open(SHELL);
        expect(cache.store.size).toBe(4);
    });
});

describe("sw.js — activate", () => {
    it("drops every cache except the current shell, then claims open tabs", async () => {
        const sw = bootSw();
        await sw.caches.open("bb-shell-v0-old");
        await sw.caches.open(SHELL);
        await sw.fire("activate");
        expect(await sw.caches.keys()).toEqual([SHELL]);
        expect(sw.claim).toHaveBeenCalled();
    });
});

describe("sw.js — fetch: what is deliberately NOT intercepted", () => {
    it("never touches /api/* — stale task data is worse than no task data", async () => {
        const sw = bootSw();
        const { responded } = await sw.fire("fetch", {
            request: req("https://tasks.example.com/api/v1/tasks/my-work"),
        });
        expect(responded).toBeUndefined();
    });

    it("never serves itself from cache (/sw.js), or a deploy could never land", async () => {
        const sw = bootSw();
        const { responded } = await sw.fire("fetch", {
            request: req("https://tasks.example.com/sw.js"),
        });
        expect(responded).toBeUndefined();
    });

    it("leaves cross-origin requests alone (fonts, CDNs)", async () => {
        const sw = bootSw();
        const { responded } = await sw.fire("fetch", {
            request: req("https://fonts.gstatic.com/s/inter.woff2"),
        });
        expect(responded).toBeUndefined();
    });

    it("ignores non-GET requests entirely", async () => {
        const sw = bootSw();
        const { responded } = await sw.fire("fetch", {
            request: req("https://tasks.example.com/", { method: "POST" }),
        });
        expect(responded).toBeUndefined();
    });
});

describe("sw.js — fetch: hashed assets are cache-first", () => {
    it("serves a cached asset without going to the network", async () => {
        const sw = bootSw();
        const url = "https://tasks.example.com/assets/index-03KaeTLH.js";
        (await sw.caches.open(SHELL)).store.set(url, { cached: true });
        sw.fetchMock.mockClear();

        const { response } = await sw.fire("fetch", { request: req(url) });
        expect(response).toMatchObject({ cached: true });
        expect(sw.fetchMock).not.toHaveBeenCalled();
    });

    it("fetches and stores a miss, so the next load is offline-safe", async () => {
        const sw = bootSw();
        const url = "https://tasks.example.com/assets/index-new.js";
        await sw.fire("fetch", { request: req(url) });
        expect(sw.fetchMock).toHaveBeenCalledTimes(1);
        expect(await (await sw.caches.open(SHELL)).match(url)).toBeDefined();
    });
});

describe("sw.js — fetch: the shell is network-first", () => {
    it("prefers the network so a deploy is picked up on the next online load", async () => {
        const sw = bootSw();
        (await sw.caches.open(SHELL)).store.set("/", { stale: true });
        sw.fetchMock.mockClear();

        const { response } = await sw.fire("fetch", {
            request: req("https://tasks.example.com/board", { mode: "navigate" }),
        });
        expect(sw.fetchMock).toHaveBeenCalledTimes(1);
        expect(response).toMatchObject({ fromNetwork: true });
    });

    it("falls back to the cached shell when the network is gone", async () => {
        const sw = bootSw();
        (await sw.caches.open(SHELL)).store.set("/", { offlineCopy: true });
        sw.fetchMock.mockRejectedValueOnce(new Error("offline"));

        const { response } = await sw.fire("fetch", {
            request: req("https://tasks.example.com/board", { mode: "navigate" }),
        });
        expect(response).toMatchObject({ offlineCopy: true });
    });

    it("offline with nothing cached returns a network error, not a blank lie", async () => {
        const sw = bootSw();
        sw.fetchMock.mockRejectedValueOnce(new Error("offline"));
        const { response } = await sw.fire("fetch", {
            request: req("https://tasks.example.com/board", { mode: "navigate" }),
        });
        expect(response).toMatchObject({ type: "error" });
    });
});

describe("sw.js — push", () => {
    it("shows the server's {title, body, tag, url} payload", async () => {
        const sw = bootSw();
        await sw.fire("push", {
            data: {
                json: () => ({
                    title: "Rina assigned you a task",
                    body: "Ship the September catalogue",
                    url: "/t/t-42",
                    tag: "bb-assigned-t-42",
                }),
            },
        });
        expect(sw.showNotification).toHaveBeenCalledWith(
            "Rina assigned you a task",
            expect.objectContaining({
                body: "Ship the September catalogue",
                tag: "bb-assigned-t-42",
                data: { url: "/t/t-42" },
            }),
        );
    });

    it("still shows a bubble for a non-JSON payload — userVisibleOnly is a promise to the browser", async () => {
        const sw = bootSw();
        await sw.fire("push", {
            data: {
                json: () => {
                    throw new Error("not json");
                },
            },
        });
        expect(sw.showNotification).toHaveBeenCalledWith(
            "BeautyBooth Tasks",
            expect.objectContaining({ data: { url: "/inbox" } }),
        );
    });

    it("shows a bubble even with no payload at all", async () => {
        const sw = bootSw();
        await sw.fire("push", { data: null });
        expect(sw.showNotification).toHaveBeenCalledTimes(1);
    });
});

describe("sw.js — notificationclick", () => {
    it("reuses an open window rather than opening a duplicate", async () => {
        const sw = bootSw();
        const focus = vi.fn(async () => undefined);
        const navigate = vi.fn(async () => undefined);
        sw.windows.push({ focus, navigate });

        await sw.fire("notificationclick", {
            notification: { close: vi.fn(), data: { url: "/t/t-9" } },
        });

        expect(focus).toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith("/t/t-9");
        expect(sw.openWindow).not.toHaveBeenCalled();
    });

    it("opens a new window when none is open", async () => {
        const sw = bootSw();
        await sw.fire("notificationclick", {
            notification: { close: vi.fn(), data: { url: "/inbox" } },
        });
        expect(sw.openWindow).toHaveBeenCalledWith("/inbox");
    });

    it("defaults to /inbox when the payload named no url", async () => {
        const sw = bootSw();
        await sw.fire("notificationclick", { notification: { close: vi.fn() } });
        expect(sw.openWindow).toHaveBeenCalledWith("/inbox");
    });
});
