import { beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { User } from "../types";

/**
 * The auth store is replaced with a plain object so this file tests ONE thing:
 * the interceptor's decisions. What `logout()` actually scrubs is the subject
 * of `stores/auth.test.ts`, which uses the real store.
 */
const store = {
    accessToken: null as string | null,
    setAccessToken: vi.fn((t: string) => {
        store.accessToken = t;
    }),
    logout: vi.fn(),
};
vi.mock("../stores/auth", () => ({
    useAuthStore: { getState: () => store },
}));

const { api, refreshAccessToken, camelizeKeys, decamelizeKeys, getApiError, getApiErrorMessage } =
    await import("./client");

/**
 * THE AXIOS LAYER — the code every single request in this application passes
 * through, and which had no test at all.
 *
 * Two of its behaviours are load-bearing and neither is obvious from reading a
 * call site:
 *
 *   1. A 401 normally means "the access token aged out" — refresh once using
 *      the bb_refresh cookie and replay the request. That is what keeps a
 *      15-minute token invisible to the person using the app.
 *
 *   2. EXCEPT on the auth endpoints themselves (gap-scan H4). A 401 from
 *      /auth/login is not a stale token, it is the answer: the password was
 *      wrong. Refresh-retrying it would re-POST the credentials a second time,
 *      replace a precise "wrong password" with whatever the refresh failure
 *      says, and — for someone already signed in on the same browser — end by
 *      purging a session that was perfectly healthy.
 *
 * The distinction lives in four lines of string matching, and nothing until now
 * would have noticed if a refactor dropped one of them.
 */

// ── plumbing ────────────────────────────────────────────────────────────────

/** A rejection shaped exactly like a real HTTP failure from axios. */
const httpError = (
    status: number,
    config: InternalAxiosRequestConfig,
    data: unknown = {},
): AxiosError =>
    new AxiosError(`Request failed with status code ${status}`, String(status), config, null, {
        status,
        statusText: "",
        data,
        headers: {},
        config,
    } as never);

/** An adapter that answers each call from a queue of canned outcomes. */
type Outcome = { ok: true; data: unknown } | { ok: false; status: number; data?: unknown };
const seen: InternalAxiosRequestConfig[] = [];
let queue: Outcome[] = [];

const installAdapter = () => {
    api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
        seen.push(config);
        const next = queue.shift() ?? { ok: true as const, data: {} };
        if (!next.ok) throw httpError(next.status, config, next.data ?? {});
        return {
            data: next.data,
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        } as never;
    };
};

beforeEach(() => {
    seen.length = 0;
    queue = [];
    store.accessToken = null;
    store.setAccessToken.mockClear();
    store.logout.mockClear();
    vi.restoreAllMocks();
    installAdapter();
});

/** Stub the RAW axios.post that `refreshAccessToken` uses. */
const stubRefresh = (outcome: "ok" | "fail", token = "fresh-token") =>
    vi.spyOn(axios, "post").mockImplementation(() =>
        outcome === "ok"
            ? Promise.resolve({ data: { access_token: token } } as never)
            : Promise.reject(new Error("refresh failed")),
    );

// ── the H4 guard ────────────────────────────────────────────────────────────

describe("401 handling — the auth endpoints are exempt (gap-scan H4)", () => {
    it("does NOT refresh-retry a wrong-password 401 from /auth/login", async () => {
        const refresh = stubRefresh("ok");
        queue = [{ ok: false, status: 401, data: { error: { code: "auth.invalid_credentials" } } }];

        await expect(api.post("/auth/login", { email: "a@b.c", password: "no" })).rejects.toThrow();

        expect(refresh).not.toHaveBeenCalled();
        expect(seen).toHaveLength(1); // sent once — the credentials are not replayed
        expect(store.logout).not.toHaveBeenCalled(); // a signed-in session survives
    });

    it("surfaces the login failure's own error envelope, not a refresh error", async () => {
        stubRefresh("ok");
        queue = [
            {
                ok: false,
                status: 401,
                data: {
                    error: {
                        code: "auth.invalid_credentials",
                        message: "Email or password is incorrect.",
                        request_id: "req-1",
                    },
                },
            },
        ];

        const err = await api.post("/auth/login", {}).catch((e: unknown) => e);
        expect(getApiError(err)?.code).toBe("auth.invalid_credentials");
        expect(getApiErrorMessage(err)).toBe("Email or password is incorrect.");
    });

    it("does NOT refresh-retry a 401 from /auth/refresh itself (no recursion)", async () => {
        const refresh = stubRefresh("ok");
        queue = [{ ok: false, status: 401 }];

        await expect(api.post("/auth/refresh")).rejects.toThrow();

        expect(refresh).not.toHaveBeenCalled();
        expect(seen).toHaveLength(1);
    });

    it("does NOT refresh-retry a 401 from the 2FA endpoint", async () => {
        // The server has no 2FA route today; the client keeps the branch for
        // the flow it is scaffolded for. Exempting it is right either way — a
        // rejected second factor is an answer, not a stale token.
        const refresh = stubRefresh("ok");
        queue = [{ ok: false, status: 401 }];

        await expect(api.post("/auth/2fa/verify", { code: "000000" })).rejects.toThrow();

        expect(refresh).not.toHaveBeenCalled();
    });
});

describe("401 handling — everything else refreshes once", () => {
    it("refreshes, stores the new token, and replays the request", async () => {
        const refresh = stubRefresh("ok", "token-2");
        queue = [{ ok: false, status: 401 }, { ok: true, data: { id: "t-1" } }];

        const res = await api.get("/tasks/t-1");

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(store.setAccessToken).toHaveBeenCalledWith("token-2");
        expect(seen).toHaveLength(2); // original + replay
        expect(res.data).toEqual({ id: "t-1" });
    });

    it("re-attaches the NEW token on the replay, not the stale one", async () => {
        // The point of storing the token before replaying: the retry must not
        // repeat the request that just failed, header and all.
        store.accessToken = "stale";
        stubRefresh("ok", "token-3");
        queue = [{ ok: false, status: 401 }, { ok: true, data: {} }];

        await api.get("/tasks");

        expect(seen[0].headers.Authorization).toBe("Bearer stale");
        expect(seen[1].headers.Authorization).toBe("Bearer token-3");
    });

    it("gives up after ONE retry — a second 401 does not loop", async () => {
        const refresh = stubRefresh("ok");
        queue = [{ ok: false, status: 401 }, { ok: false, status: 401 }];

        await expect(api.get("/tasks")).rejects.toThrow();

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(seen).toHaveLength(2); // and no third attempt
    });

    it("purges locally when the refresh itself fails, without calling logout on the server", async () => {
        stubRefresh("fail");
        queue = [{ ok: false, status: 401 }];

        await expect(api.get("/tasks")).rejects.toThrow("refresh failed");

        expect(store.logout).toHaveBeenCalledTimes(1);
        // `revoke: false` — the session is already dead server-side, and the
        // request that would revoke it is the one that just 401'd.
        expect(store.logout).toHaveBeenCalledWith({ revoke: false });
        expect(seen).toHaveLength(1);
    });

    it("shares ONE refresh across concurrent 401s (no thundering herd)", async () => {
        const refresh = stubRefresh("ok");
        queue = [
            { ok: false, status: 401 },
            { ok: false, status: 401 },
            { ok: false, status: 401 },
            { ok: true, data: { n: 1 } },
            { ok: true, data: { n: 2 } },
            { ok: true, data: { n: 3 } },
        ];

        const results = await Promise.all([
            api.get("/a"),
            api.get("/b"),
            api.get("/c"),
        ]);

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(results.map((r) => (r.data as { n: number }).n).sort()).toEqual([1, 2, 3]);
    });

    it("leaves non-401 failures completely alone", async () => {
        const refresh = stubRefresh("ok");
        for (const status of [400, 403, 404, 409, 422, 500]) {
            seen.length = 0;
            queue = [{ ok: false, status }];
            await expect(api.get("/tasks")).rejects.toThrow();
            expect(seen).toHaveLength(1);
        }
        expect(refresh).not.toHaveBeenCalled();
    });

    it("does not store a token when the refresh answers without one", async () => {
        vi.spyOn(axios, "post").mockResolvedValue({ data: {} } as never);
        queue = [{ ok: false, status: 401 }, { ok: true, data: {} }];

        await api.get("/tasks");

        expect(store.setAccessToken).not.toHaveBeenCalled();
    });

    it("de-dupes only while in flight — a later 401 refreshes again", async () => {
        const refresh = stubRefresh("ok");
        queue = [{ ok: false, status: 401 }, { ok: true, data: {} }];
        await api.get("/first");
        queue = [{ ok: false, status: 401 }, { ok: true, data: {} }];
        await api.get("/second");
        expect(refresh).toHaveBeenCalledTimes(2);
    });
});

describe("refreshAccessToken — the shared entry point", () => {
    it("posts to the full /auth/refresh path with credentials", async () => {
        const refresh = stubRefresh("ok", "t");
        await refreshAccessToken();
        const [url, body, config] = refresh.mock.calls[0] as [
            string,
            unknown,
            { withCredentials?: boolean },
        ];
        // The FULL path matters: bb_refresh is a path-scoped cookie, so a
        // relative or trimmed URL would send the request without it.
        expect(url).toMatch(/\/auth\/refresh$/);
        expect(body).toEqual({});
        expect(config.withCredentials).toBe(true);
    });
});

// ── the case transform ──────────────────────────────────────────────────────

describe("case transform", () => {
    it("camelizes a response body recursively", async () => {
        queue = [{ ok: true, data: { task_id: "t1", nested: [{ due_date: "x" }] } }];
        const res = await api.get("/tasks");
        expect(res.data).toEqual({ taskId: "t1", nested: [{ dueDate: "x" }] });
    });

    it("decamelizes a request body recursively", async () => {
        queue = [{ ok: true, data: {} }];
        await api.post("/tasks", { taskName: "x", primaryListId: "l1" });
        expect(seen[0].data).toEqual(
            JSON.stringify({ task_name: "x", primary_list_id: "l1" }),
        );
    });

    it("honours skipDecamelize for verbatim-camelCase blobs", async () => {
        queue = [{ ok: true, data: {} }];
        await api.post("/templates", { structure: { taskTypeId: "tt1" } }, { skipDecamelize: true });
        expect(seen[0].data).toEqual(JSON.stringify({ structure: { taskTypeId: "tt1" } }));
    });

    it("leaves /me/permissions keys alone — camelizing them would hide controls", async () => {
        // The permission map is KEYED BY PERMISSION KEY. Camelizing
        // `catalog.task_types` to `catalog.taskTypes` makes every lookup miss,
        // and the UI silently hides controls the person actually holds.
        queue = [
            {
                ok: true,
                data: { permissions: { "catalog.task_types": { all: true } }, is_owner: false },
            },
        ];
        const res = await api.get("/me/permissions");
        expect(Object.keys((res.data as { permissions: object }).permissions)).toEqual([
            "catalog.task_types",
        ]);
        expect(res.data).toHaveProperty("is_owner", false);
    });

    it("leaves an opaque custom_field_values map's inner keys untouched", () => {
        const wire = { custom_field_values: { "cf-1": { option_id: "o1" } } };
        expect(camelizeKeys(wire)).toEqual({
            customFieldValues: { "cf-1": { option_id: "o1" } },
        });
    });

    it("round-trips a plain object through both directions", () => {
        const camel = { firstName: "a", nested: { dueDate: "b" } };
        expect(camelizeKeys(decamelizeKeys(camel))).toEqual(camel);
    });
});

describe("the /auth/me contract, end to end", () => {
    it("camelizes the server's ten keys onto exactly the User type's fields", () => {
        // The wire shape is pinned on the other side by
        // `server/tests/auth/me.test.ts` ("returns exactly the 10 Appendix-A
        // User keys"). This is the half nothing covered: that those ten keys,
        // once through the interceptor, ARE what `User` declares — no field
        // silently absent, none arriving under a name the app never reads.
        const wire = {
            id: "u-1",
            first_name: "A",
            last_name: "B",
            email: "a@company.local",
            role: "member",
            avatar_url: null,
            status: "active",
            timezone: "Asia/Dhaka",
            created_at: "2026-01-01T00:00:00.000Z",
            last_login_at: null,
        };

        // `satisfies` hands the assertion to the compiler: add a field to
        // `User` and this file stops building until the wire list above grows
        // to match, which is the moment to go and check the serializer.
        const fields = {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            avatarUrl: true,
            status: true,
            timezone: true,
            createdAt: true,
            lastLoginAt: true,
        } satisfies Record<keyof User, true>;

        expect(Object.keys(camelizeKeys(wire) as object).sort()).toEqual(
            Object.keys(fields).sort(),
        );
    });

    it("never lets a secret through even if the server were to leak one", () => {
        // Defence in depth for the shape, not the server: the interceptor is a
        // pass-through, so if `password_hash` ever appeared on the wire it
        // would arrive in the client as `passwordHash`. The server test asserts
        // it is absent; this records that nothing downstream would catch it.
        const leaked = camelizeKeys({ id: "u-1", password_hash: "$2b$10$…" }) as Record<
            string,
            unknown
        >;
        expect(leaked).toHaveProperty("passwordHash");
    });
});

// ── the error envelope ──────────────────────────────────────────────────────

describe("getApiErrorMessage", () => {
    it("prefers the per-field details over the generic envelope line", () => {
        // "One or more fields failed validation." is the sentence that left
        // people staring at an invitation form that refused them and said
        // nothing. The reasons live in details[].
        const err = new AxiosError("x", "422", {} as never, null, {
            status: 422,
            data: {
                error: {
                    code: "validation.failed",
                    message: "One or more fields failed validation",
                    details: [{ field: "password", issue: "Password must contain a number (0–9)" }],
                },
            },
        } as never);
        expect(getApiErrorMessage(err)).toBe("Password must contain a number (0–9).");
    });

    it("caps the list and says how many more there are", () => {
        const issues = ["one", "two", "three", "four", "five"].map((i) => ({ issue: i }));
        const err = new AxiosError("x", "422", {} as never, null, {
            status: 422,
            data: { error: { code: "validation.failed", message: "m", details: issues } },
        } as never);
        expect(getApiErrorMessage(err)).toBe("one. two. three. (+2 more)");
    });

    it("falls back to the raw Error message when there is no envelope", () => {
        expect(getApiErrorMessage(new Error("Network Error"))).toBe("Network Error");
        expect(getApiErrorMessage("not an error")).toBe("Something went wrong. Try again.");
    });
});
