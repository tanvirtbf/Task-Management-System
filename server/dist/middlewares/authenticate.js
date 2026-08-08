"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = authenticate;
const express_jwt_1 = require("express-jwt");
const config_1 = require("../config");
const verifyJwt = (0, express_jwt_1.expressjwt)({
    secret: config_1.Config.ACCESS_TOKEN_SECRET,
    algorithms: ["HS256"],
    getToken(req) {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            // RFC 6750: the scheme is `Bearer`, case-insensitive. Splitting
            // blindly and taking [1] would also accept `Basic <jwt>` etc. —
            // scheme-blindness is a footgun (proxies / caches may treat the
            // two differently), so we pin the scheme here.
            const [scheme, token] = authHeader.split(" ");
            if (scheme?.toLowerCase() === "bearer" &&
                token &&
                token !== "undefined") {
                return token;
            }
        }
        const { accessToken } = req.cookies;
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
function authenticate(req, res, next) {
    verifyJwt(req, res, (err) => {
        if (err)
            return next(err);
        const auth = req.auth;
        if (typeof auth?.exp !== "number") {
            return next(new express_jwt_1.UnauthorizedError("invalid_token", {
                message: "Access token must carry an exp claim",
            }));
        }
        next();
    });
}
