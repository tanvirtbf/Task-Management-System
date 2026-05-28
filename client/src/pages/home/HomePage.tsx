import { tokens } from "../../theme";
import { HomeGreeting } from "./HomeGreeting";
import { KpiRow } from "./KpiRow";
import { MyWorkCard } from "./MyWorkCard";
import { AgendaCard } from "./AgendaCard";
import { LineupCard } from "./LineupCard";
import { RecentActivityCard } from "./RecentActivityCard";

const HomePage = () => (
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

export default HomePage;
