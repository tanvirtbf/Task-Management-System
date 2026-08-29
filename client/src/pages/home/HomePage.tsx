import { tokens } from "../../theme";
import { useIsMobile } from "../../hooks/useIsMobile";
import { KpiStrip } from "./KpiStrip";
import { HomeGreeting } from "./HomeGreeting";
import { KpiRow } from "./KpiRow";
import { MyWorkCard } from "./MyWorkCard";
import { AgendaCard } from "./AgendaCard";
import { LineupCard } from "./LineupCard";
import { RecentActivityCard } from "./RecentActivityCard";

const HomePage = () => {
    const isMobile = useIsMobile();

    // P5 — work first. The desktop layout puts six 230px KPI cards above
    // everything, which on a phone meant scrolling past three of them before
    // reaching a single task. Here the numbers are one scrollable strip and My
    // Work comes straight after; Agenda, LineUp and Activity follow, because
    // they are worth having but nobody opens Home for them.
    if (isMobile) {
        return (
            <div
                style={{
                    padding: `${tokens.spacing[4]}px ${tokens.spacing[4]}px ${tokens.spacing[6]}px`,
                    display: "flex",
                    flexDirection: "column",
                    gap: tokens.spacing[4],
                }}
            >
                <HomeGreeting />
                <KpiStrip />
                <MyWorkCard />
                <AgendaCard />
                <LineupCard />
                <RecentActivityCard />
            </div>
        );
    }

    return (
    <div
        style={{
            padding: `${tokens.spacing[6]}px ${tokens.spacing[6]}px ${tokens.spacing[8]}px`,
            maxWidth: 1440,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: tokens.spacing[5],
        }}
    >
        <HomeGreeting />
        <KpiRow />

        {/* Middle row — My Work (2 cols) + Agenda (1 col) */}
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
                gap: tokens.spacing[4],
            }}
            className="home-middle-row"
        >
            <MyWorkCard />
            <AgendaCard />
        </div>

        {/* Bottom row — LineUp / Activity */}
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: tokens.spacing[4],
            }}
            className="home-bottom-row"
        >
            <LineupCard />
            <RecentActivityCard />
        </div>

        <style>{`
            @media (max-width: 1024px) {
                .home-middle-row,
                .home-bottom-row {
                    grid-template-columns: 1fr !important;
                }
            }
        `}</style>
    </div>
    );
};

export default HomePage;
