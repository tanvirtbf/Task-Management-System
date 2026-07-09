import { checkSchema } from "express-validator";
import { bugSeverities, reporterTeams } from "../db/schema/_shared";

/**
 * Validators for §29 SLA management. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures surface as the spec envelope (422 /
 * `validation.failed`). The "in the future" check for #2 is NOT here — it lives
 * in the service so it can emit the marquee code `sla.invalid_due_at`.
 */

const ID_MAX = 64; // VARCHAR(64) id columns

type Severity = (typeof bugSeverities)[number];

/**
 * `?team=` accepts a `reporter_team` value OR the `engineering` alias (which the
 * service resolves to dev-type tasks — `reporter_team` has no "engineering").
 */
const TEAM_VALUES = [...reporterTeams, "engineering"];

/** `GET /api/v1/sla/breached` — optional `?team=` + `?severity=S0,S1` filters. */
export const breachedSlaValidator = checkSchema({
    team: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [TEAM_VALUES],
            errorMessage: `team must be one of: ${TEAM_VALUES.join(", ")}`,
        },
    },
    severity: {
        in: ["query"],
        optional: true,
        custom: {
            options: (value: unknown) => {
                const parts = String(value)
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                if (parts.length === 0) {
                    throw new Error("severity must be a comma-separated list");
                }
                for (const p of parts) {
                    if (!bugSeverities.includes(p as Severity)) {
                        throw new Error(
                            `severity values must be one of: ${bugSeverities.join(", ")}`,
                        );
                    }
                }
                return true;
            },
        },
    },
});

/**
 * `PATCH /api/v1/tasks/:id/sla` — `:id` path param + a required `sla_due_at`
 * body field that is either an ISO-8601 timestamp (set) or `null` (clear). An
 * absent key is rejected (the body must declare its intent).
 */
export const overrideSlaValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `id is too long (max ${ID_MAX} chars)`,
        },
    },
    sla_due_at: {
        in: ["body"],
        custom: {
            options: (value: unknown) => {
                if (value === null) return true;
                if (
                    typeof value === "string" &&
                    value.length > 0 &&
                    !Number.isNaN(Date.parse(value))
                ) {
                    return true;
                }
                throw new Error(
                    "sla_due_at must be an ISO-8601 timestamp string, or null to clear",
                );
            },
        },
    },
});
