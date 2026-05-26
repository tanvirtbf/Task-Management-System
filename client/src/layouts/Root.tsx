import { Outlet } from "react-router-dom";

/**
 * Root layout. In mock mode, auth state is hydrated from localStorage
 * by Zustand persist — no /auth/self fetch needed. Phase 12 will add
 * a global error boundary here.
 */
const Root = () => <Outlet />;

export default Root;
