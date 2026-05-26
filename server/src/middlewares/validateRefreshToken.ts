import { expressjwt } from "express-jwt";
import { Request } from "express";
import { and, eq } from "drizzle-orm";
import { Config } from "../config";
import { AuthCookie, IRefreshTokenPayload } from "../types";
import { getDb } from "../db/client";
import { refreshTokens } from "../db/schema";
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
            const id = Number((token?.payload as IRefreshTokenPayload).id);
            const userId = Number(token?.payload.sub);

            const [row] = await db
                .select()
                .from(refreshTokens)
                .where(
                    and(
                        eq(refreshTokens.id, id),
                        eq(refreshTokens.userId, userId),
                    ),
                )
                .limit(1);

            return !row;
        } catch (err) {
            logger.error("Error while getting the refresh token", {
                id: (token?.payload as IRefreshTokenPayload).id,
            });
            return true;
        }
    },
});
