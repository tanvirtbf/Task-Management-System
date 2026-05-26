import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

/**
 * Guards authenticated routes. If no user in store, redirects to /login.
 * Used as a wrapper route element.
 */
const RequireAuth = () => {
    const user = useAuthStore((s) => s.user);
    const location = useLocation();

    if (!user) {
        return (
            <Navigate
                to="/login"
                replace
                state={{ from: location.pathname }}
            />
        );
    }
    return <Outlet />;
};

export default RequireAuth;
