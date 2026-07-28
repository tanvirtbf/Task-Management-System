"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_jwt_1 = require("express-jwt");
const drizzle_orm_1 = require("drizzle-orm");
const config_1 = require("../config");
const client_1 = require("../db/client");
const schema_1 = require("../db/schema");
const logger_1 = __importDefault(require("../config/logger"));
exports.default = (0, express_jwt_1.expressjwt)({
    secret: config_1.Config.REFRESH_TOKEN_SECRET,
    algorithms: ["HS256"],
    getToken(req) {
        const { refreshToken } = req.cookies;
        return refreshToken;
    },
    async isRevoked(_request, token) {
        try {
            const db = (0, client_1.getDb)();
            const sessionId = (token?.payload).id;
            const userId = token?.payload.sub;
            if (!sessionId || !userId) {
                return true;
            }
            const [row] = await db
                .select({
                id: schema_1.sessions.id,
                expiresAt: schema_1.sessions.expiresAt,
                revokedAt: schema_1.sessions.revokedAt,
            })
                .from(schema_1.sessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sessions.id, sessionId), (0, drizzle_orm_1.eq)(schema_1.sessions.userId, String(userId))))
                .limit(1);
            if (!row)
                return true;
            if (row.revokedAt)
                return true;
            if (row.expiresAt.getTime() < Date.now())
                return true;
            return false;
        }
        catch (err) {
            logger_1.default.error("Error while validating the refresh token", {
                error: err instanceof Error ? err.message : String(err),
            });
            return true;
        }
    },
});
