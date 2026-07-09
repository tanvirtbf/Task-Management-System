import { NextFunction, Request, Response } from "express";
import { AuthRequest } from "../types";
import { AppError } from "../errors";

export const canAccess = (roles: string[]) => {
    return (req: Request, _res: Response, next: NextFunction) => {
        const _req = req as AuthRequest;
        const roleFromToken = _req.auth.role;

        if (!roles.includes(roleFromToken)) {
            return next(
                AppError.forbidden("auth.forbidden", "You don't have enough permissions"),
            );
        }
        next();
    };
};
