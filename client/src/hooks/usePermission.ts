import type { User } from "../type";

export const usePermission = () => {
    const allowedRoles = ["owner", "admin", "member"];

    const _hasPermission = (user: User | null | undefined) => {
        if (user) {
            return allowedRoles.includes(user.role);
        }
        return false;
    };

    return {
        isAllowed: _hasPermission,
    };
};
