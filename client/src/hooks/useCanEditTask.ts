import { useCallback } from "react";
import { usePermissions } from "./usePermissions";
import { useAuthStore } from "../stores/auth";
import { useListMap, useSpaceMap } from "./useReferenceData";
import type { Task } from "../types";

/**
 * Team-access P7 (R2.2) — may the current user EDIT this task?
 *
 * Mirrors the server rule exactly (`assertTaskScoped("task.edit", …)`):
 *   · the head of the task's owning space          → yes (the G4 allow-path)
 *   · otherwise the client-side `can("task.edit")` — `all` for admins/owners,
 *     `own` (creator or assignee) for members after upgrade 020, space-scoped
 *     for custom roles.
 *
 * UX, not security: the server enforces regardless. Used by the task mutation
 * hooks to answer with a friendly hint instead of letting a 403 be the first
 * feedback, and by the drawer for its view-only notice.
 */

export type EditableTaskFields = Pick<
    Task,
    "primaryListId" | "createdBy" | "assignees"
>;

export const EDIT_DENIED_HINT =
    "Only assignees, the creator or the team head can edit this task.";

export const useCanEditTask = () => {
    const { can, ready } = usePermissions();
    const me = useAuthStore((s) => s.user);
    const listMap = useListMap();
    const spaceMap = useSpaceMap();

    return useCallback(
        (task: EditableTaskFields): boolean => {
            // Before permissions load (or without a session) the server is
            // the only judge — fail open in the UI rather than flash locks.
            if (!ready || !me) return true;
            const list = listMap.get(task.primaryListId);
            const space = list ? spaceMap.get(list.spaceId) : undefined;
            if (space?.headUserId === me.id) return true; // head allow-path
            const isOwn =
                task.createdBy === me.id || task.assignees.includes(me.id);
            return can("task.edit", {
                spaceId: list?.spaceId ?? null,
                isOwn,
            });
        },
        [can, ready, me, listMap, spaceMap],
    );
};
