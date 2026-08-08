import { expressjwt, UnauthorizedError } from "express-jwt";
import { NextFunction, Request, Response } from "express";
import { Config } from "../config";
import { AuthCookie } from "../types";

const verifyJwt = expressjwt({
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

/**
 * F10 (ISS-016): a signature-valid token WITHOUT an `exp` claim used to be
 * accepted forever. Access tokens are never checked against the `sessions`
 * table, so an exp-less token is a permanent credential no logout, reset or
 * deactivation can revoke — it converts a one-time secret leak from
 * "15 minutes of exposure" into "unrevocable access". express-jwt validates
 * `exp` only when one is present; this wrapper makes its presence mandatory.
 *
 * Thrown as express-jwt's own `UnauthorizedError` so the error handler maps it
 * to the same 401 `auth.invalid_token` envelope as every other malformed token.
 */
export default function authenticate(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    verifyJwt(req, res, (err?: unknown) => {
        if (err) return next(err);
        const auth = (req as { auth?: { exp?: number } }).auth;
        if (typeof auth?.exp !== "number") {
            return next(
                new UnauthorizedError("invalid_token", {
                    message: "Access token must carry an exp claim",
                }),
            );
        }
        next();
    });
}
