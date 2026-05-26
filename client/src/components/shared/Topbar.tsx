import { tokens } from "../../theme";
import { Breadcrumb } from "./Breadcrumb";
import { CommandPaletteTrigger } from "./CommandPaletteTrigger";
import { NotificationBell } from "./NotificationBell";
import { QuickCreateButton } from "./QuickCreateButton";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

export const Topbar = () => (
    <header
        style={{
            height: tokens.layout.headerHeight,
            background: tokens.colors.bgSurface,
            borderBottom: `1px solid ${tokens.colors.border}`,
            display: "flex",
            alignItems: "center",
            gap: tokens.spacing[3],
            padding: `0 ${tokens.spacing[4]}px`,
            position: "sticky",
            top: 0,
            zIndex: tokens.zIndex.sticky,
        }}
    >
        {/* Left — breadcrumb */}
        <div
            style={{
                minWidth: 0,
                flex: "0 1 auto",
                display: "flex",
                alignItems: "center",
            }}
        >
            <Breadcrumb />
        </div>

        {/* Center — command palette */}
        <div
            style={{
                flex: 1,
                display: "flex",
                justifyContent: "center",
                minWidth: 0,
            }}
        >
            <CommandPaletteTrigger />
        </div>

        {/* Right — actions */}
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.spacing[2],
                flexShrink: 0,
            }}
        >
            <QuickCreateButton />
            <ThemeToggle />
            <NotificationBell />
            <UserMenu />
        </div>
    </header>
);
