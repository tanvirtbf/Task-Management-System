import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { rbacApi } from "../http/rbac";
import { queryClient } from "../lib/queryClient";
import type { MyPermissions, PermissionEntry } from "../types/rbac";

/**
 * THE CLIENT'S VIEW OF WHAT IT MAY DO (RBAC_DYNAMIC_PLAN.md P25).
 *
 * ── NOT PERSISTED, ON PURPOSE ────────────────────────────────────────────────
 * A permission set in `localStorage` is a permission set that survives a
 * revocation, a sign-out on a shared machine, and a role change made while the
 * tab was closed. It is re-fetched on every app boot instead — one small
 * request, and it is the only copy that can ever be stale by less than a
 * page-load.
 *
 * ── THIS IS UX, NOT SECURITY ─────────────────────────────────────────────────
 * Every answer here is a mirror of what the server already enforces. Hiding a
 * button is a courtesy; the API refuses the call regardless. Nothing in this
 * file may ever be the ONLY thing standing between a user and an action.
 */

interface PermissionsState {
    data: MyPermissions | null;
    loading: boolean;
    /** Server's `permissions_version` — a change means "purge caches". */
    version: number | null;
    load: () => Promise<void>;
    /** Re-fetch and, if authority changed, drop every cached query (L10). */
    refresh: () => Promise<void>;
    clear: () => void;
}

const EMPTY: PermissionEntry = {
    all: false,
    space_ids: [],
    own: false,
    own_space_ids: [],
};

export const usePermissionsStore = create<PermissionsState>()(
    devtools(
        (set, get) => ({
            data: null,
            loading: false,
            version: null,
            load: async () => {
                if (get().loading) return;
                set({ loading: true });
                try {
                    const data = await rbacApi.me();
                    set({ data, version: data.version, loading: false });
                } catch {
                    // Powerless rather than all-powerful when we cannot tell.
                    set({ data: null, loading: false });
                }
            },
            refresh: async () => {
                const before = get().version;
                try {
                    const data = await rbacApi.me();
                    set({ data, version: data.version });
                    if (before !== null && before !== data.version) {
                        // Landmine L10: react-query caches hold rows the user
                        // may no longer be allowed to see (or is newly allowed
                        // to). Nothing cached survives an authority change.
                        queryClient.clear();
                    }
                } catch {
                    /* keep the previous snapshot; the API still enforces */
                }
            },
            clear: () => set({ data: null, version: null }),
        }),
        { name: "permissions" },
    ),
);

/**
 * What one permission grants, or an all-false entry.
 *
 * The optional chain has to cover `permissions` too, not just `data`. It
 * guarded only `data` until P8, which was fine while every caller waited for
 * `ready` — and became a crash the moment something asked early: a payload
 * without a `permissions` key threw "Cannot read properties of undefined".
 * Found by loading the production build, where the mobile top bar asks on its
 * first render. An unknown permission must read as "not granted", never as an
 * exception.
 */
export const entryFor = (
    data: MyPermissions | null,
    key: string,
): PermissionEntry => data?.permissions?.[key] ?? EMPTY;

export interface CanContext {
    spaceId?: string | null;
    /** The resource is the caller's own (they created it / are assigned). */
    isOwn?: boolean;
}

/**
 * Mirror of the server's `can()` (`server/src/rbac/can.ts`) — same four
 * reaches, same order. Keep the two in step: a divergence shows up as a button
 * that 403s, or one that is hidden for no reason.
 */
export const canWith = (
    data: MyPermissions | null,
    key: string,
    ctx?: CanContext,
): boolean => {
    const e = entryFor(data, key);
    if (e.all) return true;
    const spaceId = ctx?.spaceId ?? null;
    if (spaceId && e.space_ids.includes(spaceId)) return true;
    if (ctx?.isOwn) {
        if (e.own) return true;
        if (spaceId && e.own_space_ids.includes(spaceId)) return true;
    }
    return false;
};

/** "Could they do this anywhere?" — the question a nav item or a page asks. */
export const holdsWith = (data: MyPermissions | null, key: string): boolean => {
    const e = entryFor(data, key);
    return (
        e.all || e.own || e.space_ids.length > 0 || e.own_space_ids.length > 0
    );
};
