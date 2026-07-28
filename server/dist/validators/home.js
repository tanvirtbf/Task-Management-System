"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agendaValidator = void 0;
const express_validator_1 = require("express-validator");
/**
 * Validator for §25 `GET /api/v1/home/agenda`. `date` is optional (defaults to
 * today in the service) and, when present, must be a real `YYYY-MM-DD` calendar
 * date. `GET /api/v1/home/kpis` takes no params, so it needs no validator.
 */
exports.agendaValidator = (0, express_validator_1.checkSchema)({
    date: {
        in: ["query"],
        optional: true,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "date must be a valid YYYY-MM-DD calendar date",
        },
    },
});
