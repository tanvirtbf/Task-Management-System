import { expressjwt } from "express-jwt";
import { Request } from "express";
import { Config } from "../config";

const getTokenFromCookie = (req: Request): string | undefined => {
    return req.cookies?.accessToken;
};

export const authenticate = expressjwt({
    secret: Config.SECRET_KEY,
    algorithms: ["HS256"],
    getToken: getTokenFromCookie,
});

export const optionalAuthenticate = expressjwt({
    secret: Config.SECRET_KEY,
    algorithms: ["HS256"],
    getToken: getTokenFromCookie,
    credentialsRequired: false,
});
