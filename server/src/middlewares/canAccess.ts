import { Response, NextFunction } from "express";
import createHttpError from "http-errors";
import { AuthRequest } from "../types/authTypes";

export const canAccess = (allowedRoles: string[]) => {
    return (req: AuthRequest, _res: Response, next: NextFunction) => {
        const role = req.auth?.role;

        if (!role || !allowedRoles.includes(role)) {
            return next(createHttpError(403, "Forbidden: insufficient permissions"));
        }

        next();
    };
};
