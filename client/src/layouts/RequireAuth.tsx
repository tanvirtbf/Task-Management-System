import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { useAuthStore } from "../stores/auth";

const FullPageSpin = () => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
        }}
    >
        <Spin size="large" />
    </div>
);

/**
 * Guards authenticated routes. While the initial /auth/me bootstrap is running
 * we show a spinner (never flash the login page for a valid cookie session);
 * once resolved, a missing user redirects to /login.
 */
const RequireAuth = () => {
    const user = useAuthStore((s) => s.user);
    const bootstrapping = useAuthStore((s) => s.bootstrapping);
    const location = useLocation();

    if (bootstrapping) return <FullPageSpin />;
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
