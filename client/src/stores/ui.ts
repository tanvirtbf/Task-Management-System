import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface UiState {
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
    setSidebarCollapsed: (v: boolean) => void;

    /** Which space/folder IDs are expanded in the sidebar tree. */
    expandedIds: string[];
    toggleExpanded: (id: string) => void;
    setExpanded: (id: string, expanded: boolean) => void;

    /** Sidebar favourites — starred lists. */
    favoriteIds: string[];
    toggleFavorite: (id: string) => void;

    /** One-time first-run marker: has the assistant onboarding nudge been shown
     *  and dismissed on THIS browser. NOT reset on sign-out — it's a per-browser
     *  discoverability hint, not user data. */
    assistantNudgeSeen: boolean;
    dismissAssistantNudge: () => void;

    /** Back to defaults — called on sign-out so nothing leaks across users. */
    reset: () => void;
}

export const useUiStore = create<UiState>()(
    devtools(
        persist(
            (set, get) => ({
                sidebarCollapsed: false,
                toggleSidebar: () =>
                    set({ sidebarCollapsed: !get().sidebarCollapsed }),
                setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

                expandedIds: [],
                toggleExpanded: (id) => {
                    const ids = get().expandedIds;
                    set({
                        expandedIds: ids.includes(id)
                            ? ids.filter((x) => x !== id)
                            : [...ids, id],
                    });
                },
                setExpanded: (id, expanded) => {
                    const ids = get().expandedIds;
                    const has = ids.includes(id);
                    if (expanded && !has) set({ expandedIds: [...ids, id] });
                    if (!expanded && has)
                        set({ expandedIds: ids.filter((x) => x !== id) });
                },

                favoriteIds: [],
                toggleFavorite: (id) => {
                    const ids = get().favoriteIds;
                    set({
                        favoriteIds: ids.includes(id)
                            ? ids.filter((x) => x !== id)
                            : [...ids, id],
                    });
                },

                assistantNudgeSeen: false,
                dismissAssistantNudge: () =>
                    set({ assistantNudgeSeen: true }),

                // NOTE: assistantNudgeSeen is intentionally NOT reset here — it
                // is a per-browser hint, not per-user data.
                reset: () =>
                    set({
                        sidebarCollapsed: false,
                        expandedIds: [],
                        favoriteIds: [],
                    }),
            }),
            {
                name: "th-ui",
                partialize: (s) => ({
                    sidebarCollapsed: s.sidebarCollapsed,
                    expandedIds: s.expandedIds,
                    favoriteIds: s.favoriteIds,
                    assistantNudgeSeen: s.assistantNudgeSeen,
                }),
            },
        ),
        { name: "UiStore" },
    ),
);
