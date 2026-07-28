import { useCallback } from "react";
import {
    canWith,
    holdsWith,
    usePermissionsStore,
    type CanContext,
} from "../stores/permissions";

/**
 * The hook every gated control uses (RBAC_DYNAMIC_PLAN.md P25).
 *
 *   const { can, holds, isOwner, ready } = usePermissions();
 *   {can("task.delete", { spaceId, isOwn }) && <DeleteButton />}
 *
 * `ready` is false until the first `/me/permissions` lands. Render gated
 * controls only when ready, or a page flashes buttons it then removes.
 */
export const usePermissions = () => {
    const data = usePermissionsStore((s) => s.data);
    const loading = usePermissionsStore((s) => s.loading);

    const can = useCallback(
        (key: string, ctx?: CanContext) => canWith(data, key, ctx),
        [data],
    );
    const holds = useCallback((key: string) => holdsWith(data, key), [data]);

    return {
        can,
        holds,
        isOwner: data?.is_owner ?? false,
        role: data?.role ?? null,
        /** `null` = every space (unrestricted). */
        visibleSpaceIds: data?.visible_space_ids ?? null,
        version: data?.version ?? null,
        ready: data !== null,
        loading,
    };
};
