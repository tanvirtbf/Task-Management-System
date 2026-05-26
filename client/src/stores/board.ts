import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type CardDensity = "compact" | "comfortable";
export type SubgroupBy = "none" | "assignee" | "priority";

interface BoardState {
    /** WIP limit per `${listId}:${statusId}` — null = no limit. */
    wipLimits: Record<string, number | null>;
    setWipLimit: (
        listId: string,
        statusId: string,
        limit: number | null,
    ) => void;

    /** Per-list card display preferences. */
    cardDensity: Record<string, CardDensity>;
    setCardDensity: (listId: string, density: CardDensity) => void;

    subgroupBy: Record<string, SubgroupBy>;
    setSubgroupBy: (listId: string, by: SubgroupBy) => void;

    /** Visible card fields per list. */
    cardFields: Record<string, string[]>;
    setCardFields: (listId: string, fields: string[]) => void;

    /** Collapsed columns per list. */
    collapsedColumns: Record<string, string[]>;
    toggleColumnCollapse: (listId: string, statusId: string) => void;
}

const DEFAULT_FIELDS = ["priority", "due_date", "assignees", "tags", "meta"];

export const useBoardStore = create<BoardState>()(
    devtools(
        persist(
            (set, get) => ({
                wipLimits: {
                    // Demo defaults for Facebook Orders to showcase WIP visualization
                    "l-fb-orders:l-fb-orders-s-confirmed": 8,
                    "l-fb-orders:l-fb-orders-s-packed": 5,
                    "l-fb-orders:l-fb-orders-s-courier": 6,
                },
                setWipLimit: (listId, statusId, limit) => {
                    const key = `${listId}:${statusId}`;
                    set((s) => ({
                        wipLimits: { ...s.wipLimits, [key]: limit },
                    }));
                },

                cardDensity: {},
                setCardDensity: (listId, density) =>
                    set((s) => ({
                        cardDensity: { ...s.cardDensity, [listId]: density },
                    })),

                subgroupBy: {},
                setSubgroupBy: (listId, by) =>
                    set((s) => ({
                        subgroupBy: { ...s.subgroupBy, [listId]: by },
                    })),

                cardFields: {},
                setCardFields: (listId, fields) =>
                    set((s) => ({
                        cardFields: { ...s.cardFields, [listId]: fields },
                    })),

                collapsedColumns: {},
                toggleColumnCollapse: (listId, statusId) => {
                    const list = get().collapsedColumns[listId] ?? [];
                    const next = list.includes(statusId)
                        ? list.filter((x) => x !== statusId)
                        : [...list, statusId];
                    set((s) => ({
                        collapsedColumns: {
                            ...s.collapsedColumns,
                            [listId]: next,
                        },
                    }));
                },
            }),
            { name: "th-board" },
        ),
        { name: "BoardStore" },
    ),
);

export const getCardFields = (listId: string): string[] => {
    const state = useBoardStore.getState();
    return state.cardFields[listId] ?? DEFAULT_FIELDS;
};
