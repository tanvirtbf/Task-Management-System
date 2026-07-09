import { useCallback, useRef, useState } from "react";

/**
 * Reusable multi-select hook with shift-click range support.
 */
export const useMultiSelect = (allIdsInOrder: string[]) => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const lastIndexRef = useRef<number | null>(null);

    const toggle = useCallback(
        (id: string, opts?: { shift?: boolean; ctrl?: boolean }) => {
            const idx = allIdsInOrder.indexOf(id);
            if (opts?.shift && lastIndexRef.current !== null && idx >= 0) {
                const [from, to] = [
                    Math.min(lastIndexRef.current, idx),
                    Math.max(lastIndexRef.current, idx),
                ];
                const range = allIdsInOrder.slice(from, to + 1);
                setSelected((prev) => {
                    const next = new Set(prev);
                    range.forEach((x) => next.add(x));
                    return next;
                });
            } else {
                setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) {
                        next.delete(id);
                    } else {
                        next.add(id);
                    }
                    return next;
                });
                lastIndexRef.current = idx;
            }
        },
        [allIdsInOrder],
    );

    const isSelected = useCallback(
        (id: string) => selected.has(id),
        [selected],
    );

    const clear = useCallback(() => {
        setSelected(new Set());
        lastIndexRef.current = null;
    }, []);

    const selectAll = useCallback(() => {
        setSelected(new Set(allIdsInOrder));
    }, [allIdsInOrder]);

    const count = selected.size;
    const ids = Array.from(selected);

    return { selected, ids, count, isSelected, toggle, clear, selectAll };
};
