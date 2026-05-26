import { Outlet } from "react-router-dom";
import { tokens } from "../theme";

/**
 * Standalone layout for public form pages.
 * No app sidebar, no chrome. The form fills the viewport.
 */
const PublicFormLayout = () => (
    <div
        style={{
            minHeight: "100vh",
            background: tokens.colors.bgPage,
            display: "flex",
            flexDirection: "column",
        }}
    >
        <Outlet />
    </div>
);

export default PublicFormLayout;
