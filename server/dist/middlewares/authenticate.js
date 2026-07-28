"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_jwt_1 = require("express-jwt");
const config_1 = require("../config");
exports.default = (0, express_jwt_1.expressjwt)({
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
