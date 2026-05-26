import { expressjwt } from "express-jwt";
import { Request } from "express";
import { Config } from "../config";
import { AuthCookie } from "../types";

export default expressjwt({
    secret: Config.ACCESS_TOKEN_SECRET!,
    algorithms: ["HS256"],
    getToken(req: Request) {
        const authHeader = req.headers.authorization;

        // Bearer <token>
        if (authHeader && authHeader.split(" ")[1] !== "undefined") {
            const token = authHeader.split(" ")[1];
            if (token) {
                return token;
            }
        }

        const { accessToken } = req.cookies as AuthCookie;
        return accessToken;
    },
});
