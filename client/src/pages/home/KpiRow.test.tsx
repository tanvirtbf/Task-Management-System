import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HomeKpi } from "../../types";

const kpis = vi.fn();
vi.mock("../../http/api", () => ({ homeApi: { kpis: () => kpis() } }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KpiRow } from "./KpiRow";

/**
 * KI-23 — one absent number used to take the WHOLE APP down.
 *
 * `KpiRow` spreads six named fields straight out of the KPI payload into
 * `KpiCard`, which read `kpi.label` without checking. A server that omitted one
 * — an older build, a partial response, a field renamed API-side — threw during
 * render. And because `main.tsx` wraps the entire `RouterProvider` in the one
 * ErrorBoundary, that throw did not break Home: it replaced every route in the
 * application with the error screen until the person reloaded.
 *
 * The mobile `KpiStrip` was given this guard during the rebuild and left a note
 * saying the desktop row had the same exposure. This is that guard, plus the
 * test that says so out loud.
 */

const kpi = (label: string, value: number): HomeKpi =>
    ({ label, value, valueDisplay: String(value) }) as HomeKpi;

const FULL = {
    myTasks: kpi("My tasks", 2),
    dueToday: kpi("Due today", 0),
    overdue: kpi("Overdue", 2),
    awaitingReview: kpi("Awaiting review", 0),
    openTeamTasks: kpi("Open team tasks", 33),
    slaBreaches: kpi("SLA breaches", 0),
};

const renderRow = () => {
    const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <MemoryRouter>
            <QueryClientProvider client={qc}>
                <KpiRow />
            </QueryClientProvider>
        </MemoryRouter>,
    );
};

describe("KpiRow — a missing KPI leaves a gap, not a white screen (KI-23)", () => {
    beforeEach(() => kpis.mockReset());

    it("renders all six when the server sends all six", async () => {
        kpis.mockResolvedValue(FULL);
        renderRow();
        expect(await screen.findByText("My tasks")).toBeInTheDocument();
        expect(screen.getByText("SLA breaches")).toBeInTheDocument();
    });

    it.each([
        "myTasks",
        "dueToday",
        "overdue",
        "awaitingReview",
        "openTeamTasks",
        "slaBreaches",
    ])("survives %s being absent, and still renders the other five", async (missing) => {
        // Every field, not just one: the tile that goes missing is not something
        // this side gets to choose, and `slaBreaches` in particular renders
        // through a <Link>, which is a different path through the component.
        const partial = { ...FULL, [missing]: undefined };
        kpis.mockResolvedValue(partial);

        renderRow();

        const survivors = Object.entries(FULL)
            .filter(([k]) => k !== missing)
            .map(([, v]) => v.label);
        for (const label of survivors) {
            expect(await screen.findByText(label)).toBeInTheDocument();
        }
        expect(screen.queryByText(FULL[missing as keyof typeof FULL].label)).toBeNull();
    });

    it("survives EVERY tile being absent — an empty object is not a crash", async () => {
        // The shape an older server, or a permission-filtered response, could
        // plausibly return. Nothing renders; nothing throws.
        kpis.mockResolvedValue({});
        const { container } = renderRow();
        // Wait for the query to settle out of its skeleton state.
        await new Promise((r) => setTimeout(r, 0));
        expect(container).toBeTruthy();
        expect(screen.queryByText("My tasks")).toBeNull();
    });
});
