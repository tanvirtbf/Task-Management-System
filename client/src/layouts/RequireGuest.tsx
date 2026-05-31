import { Navigate, Outlet } from "react-router-dom";
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
 * Used on auth pages (login, forgot-password, …). Waits for the /auth/me
 * bootstrap, then redirects an already-authenticated user to /.
 */
const RequireGuest = () => {
    const user = useAuthStore((s) => s.user);
    const bootstrapping = useAuthStore((s) => s.bootstrapping);

    if (bootstrapping) return <FullPageSpin />;
    if (user) return <Navigate to="/" replace />;
    return <Outlet />;
};

export default RequireGuest;
