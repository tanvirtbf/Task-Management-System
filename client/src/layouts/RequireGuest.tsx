import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

/**
 * Used on auth pages (login, forgot-password, etc.).
 * If user is already authenticated, redirects to /.
 */
const RequireGuest = () => {
    const user = useAuthStore((s) => s.user);
    if (user) {
        return <Navigate to="/" replace />;
    }
    return <Outlet />;
};

export default RequireGuest;
