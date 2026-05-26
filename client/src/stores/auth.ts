import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { AuthState } from "../types";
import { setCurrentUser } from "../mocks/users";

export const useAuthStore = create<AuthState>()(
    devtools(
        persist(
            (set) => ({
                user: null,
                pendingTwoFactor: null,
                setUser: (user) => {
                    setCurrentUser(user); // keep mock-api currentUser in sync
                    set({ user });
                },
                logout: () => {
                    setCurrentUser(null);
                    set({ user: null, pendingTwoFactor: null });
                },
                setPendingTwoFactor: (pending) =>
                    set({ pendingTwoFactor: pending }),
            }),
            {
                name: "th-auth", // localStorage key
                partialize: (state) => ({ user: state.user }), // only persist user
                onRehydrateStorage: () => (state) => {
                    // Re-sync mock-api with persisted user on app reload
                    if (state?.user) {
                        setCurrentUser(state.user);
                    }
                },
            },
        ),
        { name: "AuthStore" },
    ),
);
