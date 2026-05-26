import { JwtPayload, sign } from "jsonwebtoken";
import createHttpError from "http-errors";
import { eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import { Config } from "../config";
import * as schema from "../db/schema";
import { refreshTokens, User } from "../db/schema";

export class TokenService {
    constructor(private db: MySql2Database<typeof schema>) {}

    generateAccessToken(payload: JwtPayload) {
        if (!Config.ACCESS_TOKEN_SECRET) {
            throw createHttpError(500, "Access token secret not configured");
        }
        return sign(payload, Config.ACCESS_TOKEN_SECRET, {
            algorithm: "HS256",
            expiresIn: "1h",
            issuer: "task-management-server",
        });
    }

    generateRefreshToken(payload: JwtPayload) {
        if (!Config.REFRESH_TOKEN_SECRET) {
            throw createHttpError(500, "Refresh token secret not configured");
        }
        return sign(payload, Config.REFRESH_TOKEN_SECRET, {
            algorithm: "HS256",
            expiresIn: "365d",
            issuer: "task-management-server",
            jwtid: String(payload.id),
        });
    }

    async persistRefreshToken(user: Pick<User, "id">) {
        const MS_IN_YEAR = 1000 * 60 * 60 * 24 * 365;

        const result = await this.db.insert(refreshTokens).values({
            userId: user.id,
            expiresAt: new Date(Date.now() + MS_IN_YEAR),
        });
        const insertId = (result as unknown as { insertId: number }[])[0]
            ?.insertId;

        const [token] = await this.db
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.id, insertId))
            .limit(1);
        return token;
    }

    async deleteRefreshToken(tokenId: number) {
        return await this.db
            .delete(refreshTokens)
            .where(eq(refreshTokens.id, tokenId));
    }
}
