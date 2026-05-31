import { checkSchema } from "express-validator";

/**
 * Validator for §25 `GET /api/v1/home/agenda`. `date` is optional (defaults to
 * today in the service) and, when present, must be a real `YYYY-MM-DD` calendar
 * date. `GET /api/v1/home/kpis` takes no params, so it needs no validator.
 */
export const agendaValidator = checkSchema({
    date: {
        in: ["query"],
        optional: true,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "date must be a valid YYYY-MM-DD calendar date",
        },
    },
});
