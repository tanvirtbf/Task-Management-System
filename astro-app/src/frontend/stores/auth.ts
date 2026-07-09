import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { AuthState } from "../types";
import { authApi } from "../http/api";

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
                logout: () => {
                    set({
                        user: null,
                        accessToken: null,
                        pendingTwoFactor: null,
                    });
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
