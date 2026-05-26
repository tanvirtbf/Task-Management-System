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

    /** Sidebar favorites (V2 — kept for forward compat). */
    favoriteIds: string[];
    toggleFavorite: (id: string) => void;

    commandPaletteOpen: boolean;
    setCommandPaletteOpen: (v: boolean) => void;

    theme: "light" | "dark";
    setTheme: (t: "light" | "dark") => void;
}

export const useUiStore = create<UiState>()(
    devtools(
        persist(
            (set, get) => ({
                sidebarCollapsed: false,
                toggleSidebar: () =>
                    set({ sidebarCollapsed: !get().sidebarCollapsed }),
                setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

                expandedIds: ["sp-ops"],
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

                commandPaletteOpen: false,
                setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),

                theme: "light",
                setTheme: (t) => set({ theme: t }),
            }),
            {
                name: "th-ui",
                partialize: (s) => ({
                    sidebarCollapsed: s.sidebarCollapsed,
                    expandedIds: s.expandedIds,
                    favoriteIds: s.favoriteIds,
                    theme: s.theme,
                }),
            },
        ),
        { name: "UiStore" },
    ),
);
