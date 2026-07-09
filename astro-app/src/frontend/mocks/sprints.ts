import type { Sprint } from "../types/sprint";

const today = new Date();
const dayMs = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const startActive = new Date(today.getTime() - 6 * dayMs);
const endActive = new Date(today.getTime() + 8 * dayMs);
const startNext = new Date(endActive.getTime() + dayMs);
const endNext = new Date(startNext.getTime() + 13 * dayMs);
const startPrev = new Date(startActive.getTime() - 15 * dayMs);
const endPrev = new Date(startActive.getTime() - dayMs);

export const sprints: Sprint[] = [
    {
        id: "spr-22",
        name: "Sprint 22",
        goal: "Stabilize checkout + add SSLCommerz",
        startDate: iso(startPrev),
        endDate: iso(endPrev),
        status: "closed",
        committedPoints: 34,
    },
    {
        id: "spr-23",
        name: "Sprint 23",
        goal: "Pathao status sync + customer-by-phone",
        startDate: iso(startActive),
        endDate: iso(endActive),
        status: "active",
        committedPoints: 42,
    },
    {
        id: "spr-24",
        name: "Sprint 24",
        goal: "Festival campaign automation + bKash",
        startDate: iso(startNext),
        endDate: iso(endNext),
        status: "planned",
        committedPoints: 28,
    },
];

export const sprintsById = new Map(sprints.map((s) => [s.id, s]));

export const activeSprint = (): Sprint | undefined =>
    sprints.find((s) => s.status === "active");
