import { expressjwt } from "express-jwt";
import { Request } from "express";
import { Config } from "../config";
import { AuthCookie } from "../types";

export default expressjwt({
    secret: Config.ACCESS_TOKEN_SECRET!,
    algorithms: ["HS256"],
    getToken(req: Request) {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            // RFC 6750: the scheme is `Bearer`, case-insensitive. Splitting
            // blindly and taking [1] would also accept `Basic <jwt>` etc. —
            // scheme-blindness is a footgun (proxies / caches may treat the
            // two differently), so we pin the scheme here.
            const [scheme, token] = authHeader.split(" ");
            if (
                scheme?.toLowerCase() === "bearer" &&
                token &&
                token !== "undefined"
            ) {
                return token;
            }
        }

        const { accessToken } = req.cookies as AuthCookie;
        return accessToken;
    },
});
