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
                }),
            },
        ),
        { name: "UiStore" },
    ),
);
