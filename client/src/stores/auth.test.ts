import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http/api", () => ({
    authApi: { logout: vi.fn(() => Promise.resolve()), me: vi.fn() },
}));
vi.mock("../lib/push", () => ({
    teardownPushSubscription: vi.fn(() => Promise.resolve()),
}));
vi.mock("../lib/queryClient", () => ({
    queryClient: { clear: vi.fn() },
}));
// `setUser(user)` kicks off a permissions fetch. Left unmocked it reaches for
// a real API on :5501 and rejects into the void — noise that would sit in the
// output of every future run and could hide a genuine failure behind it.
vi.mock("../http/rbac", () => ({
    rbacApi: { me: vi.fn(() => Promise.resolve(null)) },
}));

import { authApi } from "../http/api";
import { teardownPushSubscription } from "../lib/push";
import { queryClient } from "../lib/queryClient";
import { useAuthStore } from "./auth";
import { useChatStore } from "./chat";
import { usePermissionsStore } from "./permissions";
import { useUiStore } from "./ui";
import type { MyPermissions } from "../types/rbac";
import type { User } from "../types";

/**
 * SHARED-MACHINE HYGIENE — what has to be gone when someone signs out.
 *
 * This workspace runs on shared computers. Signing out is therefore not a
 * bookkeeping step; it is the whole boundary between one person's data and the
 * next person's. `logout()` performs seven distinct scrubs, added at different
 * times for different reasons, and until now not one of them had a test:
 *
 *   - the server session + the bb_refresh cookie (gap-scan C1: sign-out that
 *     did not sign out)
 *   - this device's push subscription (§29c — otherwise the machine keeps
 *     waking up with the previous person's task notifications)
 *   - the react-query cache (every list and task body they had loaded)
 *   - the permissions snapshot (RBAC P31 — authority outliving its session)
 *   - the assistant chat thread, and its open stream (2026-08-29: the previous
 *     person's prompts were rehydrated for the next one AND replayed to the
 *     model as history)
 *   - the UI state (which spaces were expanded — a small leak, but a leak)
 *
 * Any one of them silently dropped in a refactor would look exactly like a
 * working sign-out. The test that catches that has to assert on the REAL
 * stores, which is why only the network edges are mocked here.
 */

const someUser: User = {
    id: "u-1",
    email: "a@company.local",
    firstName: "A",
    lastName: "B",
    role: "member",
    status: "active",
    timezone: "Asia/Dhaka",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: null,
} as User;

const permissionSnapshot: MyPermissions = {
    version: 1,
    is_owner: false,
    role: "member",
    visible_space_ids: null,
    permissions: { "task.view": { all: true, space_ids: [], own: false, own_space_ids: [] } },
};

/** Put every store into a "signed in, mid-session" state. */
const signedIn = () => {
    useAuthStore.setState({
        user: someUser,
        accessToken: "access-token-value",
        bootstrapping: false,
        pendingTwoFactor: null,
    });
    usePermissionsStore.setState({ data: permissionSnapshot, version: 1 });
    useChatStore.setState({
        messages: [{ role: "user", content: "what is my salary review date?" }] as never,
        conversationId: "conv-1",
        ownerId: "u-1",
        isOpen: true,
        error: null,
    });
    useUiStore.setState({
        sidebarCollapsed: true,
        expandedIds: ["sp-1", "sp-2"],
        favoriteIds: ["t-9"],
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    signedIn();
});

describe("logout — what must be gone afterwards", () => {
    it("clears the identity and the in-memory access token", () => {
        useAuthStore.getState().logout();
        const s = useAuthStore.getState();
        expect(s.user).toBeNull();
        expect(s.accessToken).toBeNull();
        expect(s.pendingTwoFactor).toBeNull();
    });

    it("revokes the server session by default", () => {
        useAuthStore.getState().logout();
        expect(authApi.logout).toHaveBeenCalledTimes(1);
    });

    it("skips the server call when the session is already dead (revoke: false)", () => {
        // The 401 interceptor and the assistant stream pass this: the request
        // that would revoke the session is the one that just failed.
        useAuthStore.getState().logout({ revoke: false });
        expect(authApi.logout).not.toHaveBeenCalled();
        expect(useAuthStore.getState().user).toBeNull(); // still a full local purge
    });

    it("still signs out locally when the revoke request fails", () => {
        vi.mocked(authApi.logout).mockRejectedValueOnce(new Error("offline"));
        expect(() => useAuthStore.getState().logout()).not.toThrow();
        expect(useAuthStore.getState().user).toBeNull();
    });

    it("drops this device's push subscription", () => {
        useAuthStore.getState().logout();
        expect(teardownPushSubscription).toHaveBeenCalledTimes(1);
    });

    it("empties the react-query cache", () => {
        useAuthStore.getState().logout();
        expect(queryClient.clear).toHaveBeenCalledTimes(1);
    });

    it("drops the permission snapshot", () => {
        useAuthStore.getState().logout();
        expect(usePermissionsStore.getState().data).toBeNull();
    });

    it("wipes the assistant thread, its owner and its conversation id", () => {
        useAuthStore.getState().logout();
        const chat = useChatStore.getState();
        expect(chat.messages).toEqual([]);
        expect(chat.conversationId).toBeNull();
        expect(chat.ownerId).toBeNull();
    });

    it("closes the assistant panel so it cannot reopen holding the old thread", () => {
        useAuthStore.getState().logout();
        expect(useChatStore.getState().isOpen).toBe(false);
    });

    it("resets the UI state", () => {
        useAuthStore.getState().logout();
        const ui = useUiStore.getState();
        expect(ui.expandedIds).toEqual([]);
        expect(ui.favoriteIds).toEqual([]);
        expect(ui.sidebarCollapsed).toBe(false);
    });

    it("performs every scrub in one call", () => {
        // The seven together, asserted as a set: a refactor that keeps six is
        // the failure mode this test exists for.
        useAuthStore.getState().logout();
        expect({
            user: useAuthStore.getState().user,
            token: useAuthStore.getState().accessToken,
            permissions: usePermissionsStore.getState().data,
            chatMessages: useChatStore.getState().messages.length,
            chatOwner: useChatStore.getState().ownerId,
            expanded: useUiStore.getState().expandedIds.length,
            revoked: vi.mocked(authApi.logout).mock.calls.length,
            pushTornDown: vi.mocked(teardownPushSubscription).mock.calls.length,
            queryCacheCleared: vi.mocked(queryClient.clear).mock.calls.length,
        }).toEqual({
            user: null,
            token: null,
            permissions: null,
            chatMessages: 0,
            chatOwner: null,
            expanded: 0,
            revoked: 1,
            pushTornDown: 1,
            queryCacheCleared: 1,
        });
    });
});

describe("persistence — what is allowed to survive a reload", () => {
    it("never writes the access token to localStorage", () => {
        // The token is in-memory BY DESIGN; a reload re-earns it from the
        // httpOnly bb_refresh cookie. Persisting it would hand the next person
        // at this machine a working credential out of devtools.
        useAuthStore.setState({ accessToken: "super-secret-token" });
        useAuthStore.getState().setUser(someUser); // force a persist write
        const raw = localStorage.getItem("th-auth") ?? "";
        expect(raw).not.toContain("super-secret-token");
        expect(raw).not.toContain("accessToken");
    });
});

describe("setUser — the permission snapshot follows the identity", () => {
    it("clears the previous account's permissions when the user goes away", () => {
        useAuthStore.getState().setUser(null);
        expect(usePermissionsStore.getState().data).toBeNull();
    });

    it("reloads permissions for a new identity rather than reusing the old set", () => {
        const load = vi
            .spyOn(usePermissionsStore.getState(), "load")
            .mockResolvedValue(undefined as never);
        useAuthStore.getState().setUser({ ...someUser, id: "u-2" });
        expect(load).toHaveBeenCalledTimes(1);
    });
});
