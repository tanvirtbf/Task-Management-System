import { expressjwt } from "express-jwt";
import { Request } from "express";
import { and, eq } from "drizzle-orm";
import { Config } from "../config";
import { AuthCookie, IRefreshTokenPayload } from "../types";
import { getDb } from "../db/client";
import { sessions } from "../db/schema";
import logger from "../config/logger";

export default expressjwt({
    secret: Config.REFRESH_TOKEN_SECRET!,
    algorithms: ["HS256"],
    getToken(req: Request) {
        const { refreshToken } = req.cookies as AuthCookie;
        return refreshToken;
    },
    async isRevoked(_request: Request, token) {
        try {
            const db = getDb();
            const sessionId = (token?.payload as IRefreshTokenPayload).id;
            const userId = token?.payload.sub;

            if (!sessionId || !userId) {
                return true;
            }

            const [row] = await db
                .select({
                    id: sessions.id,
                    expiresAt: sessions.expiresAt,
                    revokedAt: sessions.revokedAt,
                })
                .from(sessions)
                .where(
                    and(
                        eq(sessions.id, sessionId),
                        eq(sessions.userId, String(userId)),
                    ),
                )
                .limit(1);

            if (!row) return true;
            if (row.revokedAt) return true;
            if (row.expiresAt.getTime() < Date.now()) return true;
            return false;
        } catch (err) {
            logger.error("Error while validating the refresh token", {
                error: err instanceof Error ? err.message : String(err),
            });
            return true;
        }
    },
});
