import { Outlet } from "react-router-dom";
import { Sidebar } from "../components/shared/Sidebar";
import { Topbar } from "../components/shared/Topbar";
import { OfflineIndicator } from "../components/shared/OfflineIndicator";
import { tokens } from "../theme";

/**
 * Persistent shell for all authenticated routes.
 * Sidebar (left) + Topbar + scrollable content area.
 */
const AppShell = () => (
    <div
        style={{
            display: "flex",
            minHeight: "100vh",
            background: tokens.colors.bgPage,
            color: tokens.colors.textPrimary,
        }}
    >
        <Sidebar />
        <div
            style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
            }}
        >
            <Topbar />
            <main
                style={{
                    flex: 1,
                    overflow: "auto",
                    minHeight: 0,
                }}
            >
                <Outlet />
            </main>
        </div>
        <OfflineIndicator />
    </div>
);

export default AppShell;
