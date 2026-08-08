import { tokens } from "../../theme";
import { Breadcrumb } from "./Breadcrumb";
import { CommandPaletteTrigger } from "./CommandPaletteTrigger";
import { NotificationBell } from "./NotificationBell";
import { OnCallBadge } from "./OnCallBadge";
import { QuickCreateButton } from "./QuickCreateButton";
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

        {/* Center — search */}
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
            {/* F34 (ISS-097): hidden below 480px (index.css) — the fixed
                right cluster was 6px wider than a 390px viewport, and this
                FYI chip is what sensibly yields. */}
            <span className="topbar-oncall">
                <OnCallBadge />
            </span>
            <QuickCreateButton />
            <NotificationBell />
            <UserMenu />
        </div>
    </header>
);
