import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

/**
 * Root layout. On app load it revalidates the session via GET /auth/me — the
 * axios interceptor refreshes from the `bb_refresh` cookie when the in-memory
 * access token is gone after a reload. The route guards (RequireAuth /
 * RequireGuest) show a spinner until `bootstrapping` resolves.
 */
const Root = () => {
    useEffect(() => {
        void useAuthStore.getState().bootstrap();
    }, []);

    return <Outlet />;
};

export default Root;
