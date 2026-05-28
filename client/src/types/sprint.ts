/**
 * Sprint / Iteration — Engineering-only.
 *
 * A Sprint groups tasks with a fixed start/end date and committed scope.
 * Tasks point to a sprint via `sprintId` (optional field on Task).
 */

export type SprintStatus = "planned" | "active" | "closed";

export interface Sprint {
    id: string;
    name: string;
    /** Short goal sentence — what we're trying to ship. */
    goal: string;
    startDate: string;
    endDate: string;
    status: SprintStatus;
    /** Sum of story points committed at planning time. */
    committedPoints: number;
}

/** Fibonacci-ish story-point scale. `?` = unknown / needs estimating. */
export type StoryPoints = 0 | 1 | 2 | 3 | 5 | 8 | 13;
export const STORY_POINT_OPTIONS: StoryPoints[] = [0, 1, 2, 3, 5, 8, 13];

/** Bug severity — S0 = down, S3 = backlog. */
export type BugSeverity = "S0" | "S1" | "S2" | "S3";

export const SEVERITY_META: Record<BugSeverity, {
    label: string;
    color: string;
    description: string;
}> = {
    S0: { label: "S0 — Critical", color: "#DC2626", description: "Site down or revenue blocked. 2h SLA." },
    S1: { label: "S1 — Urgent", color: "#EA580C", description: "Major feature broken for many users. 24h SLA." },
    S2: { label: "S2 — Normal", color: "#F59E0B", description: "Bug, has a workaround. 1w SLA." },
    S3: { label: "S3 — Minor", color: "#94A3B8", description: "Cosmetic / edge case. Backlog." },
};
