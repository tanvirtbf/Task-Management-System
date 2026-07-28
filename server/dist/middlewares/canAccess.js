"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canAccess = void 0;
const errors_1 = require("../errors");
const canAccess = (roles) => {
    return (req, _res, next) => {
        const _req = req;
        const roleFromToken = _req.auth.role;
        if (!roles.includes(roleFromToken)) {
            return next(errors_1.AppError.forbidden("auth.forbidden", "You don't have enough permissions"));
        }
        next();
    };
};
exports.canAccess = canAccess;
