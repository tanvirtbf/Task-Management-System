import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { AuthState } from "../types";
import { authApi } from "../http/api";
import { queryClient } from "../lib/queryClient";
import { useChatStore } from "./chat";
import { useUiStore } from "./ui";

/**
 * Auth store. After P0 the access token lives here IN MEMORY only (never
 * persisted) and is repopulated on app load by `bootstrap()` (GET /auth/me,
 * which the axios interceptor refreshes-via-cookie if the token is gone).
 */
export const useAuthStore = create<AuthState>()(
    devtools(
        persist(
            (set) => ({
                user: null,
                accessToken: null,
                bootstrapping: true,
                pendingTwoFactor: null,
                setUser: (user) => set({ user }),
                setAccessToken: (accessToken) => set({ accessToken }),
                // Gap-scan C1: sign-out must actually sign out. Revoke the
                // server session + bb_refresh cookie (fire-and-forget — the
                // request is created BEFORE the token is purged, and local
                // sign-out proceeds even if the network call fails), then
                // scrub everything user-scoped so nothing bleeds into the
                // next account on a shared machine. The 401-interceptor and
                // the assistant stream pass `revoke: false` — their session
                // is already dead server-side.
                logout: (opts) => {
                    if (opts?.revoke !== false)
                        authApi.logout().catch(() => undefined);
                    set({
                        user: null,
                        accessToken: null,
                        pendingTwoFactor: null,
                    });
                    queryClient.clear();
                    useChatStore.getState().clear();
                    useChatStore.getState().close();
                    useUiStore.getState().reset();
                },
                bootstrap: async () => {
                    try {
                        // A missing in-memory token 401s, then the interceptor
                        // refreshes via the bb_refresh cookie and retries — so a
                        // reload with a valid cookie restores the session.
                        const user = await authApi.me();
                        set({ user, bootstrapping: false });
                    } catch {
                        set({
                            user: null,
                            accessToken: null,
                            bootstrapping: false,
                        });
                    }
                },
                setPendingTwoFactor: (pending) =>
                    set({ pendingTwoFactor: pending }),
            }),
            {
                name: "th-auth", // localStorage key
                // Persist ONLY user; the access token stays in memory by design.
                partialize: (state) => ({ user: state.user }),
            },
        ),
        { name: "AuthStore" },
    ),
);
