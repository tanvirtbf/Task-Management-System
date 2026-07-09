// @ts-nocheck — dead mock layer; excluded from typecheck in the original client tsconfig (exclude: src/mocks, src/lib/mock-api.ts)
import type { Dashboard } from "../types/dashboard";

export const dashboards: Dashboard[] = [];
export const dashboardsById = new Map<string, Dashboard>();
