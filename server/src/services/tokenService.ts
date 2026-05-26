import crypto from "crypto";
import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { db, refresh_tokens } from "../db";
import { Config } from "../config";
import { AuthPayload } from "../types/authTypes";

export class TokenService {
    generateAccessToken(payload: AuthPayload): string {
        return jwt.sign(payload, Config.SECRET_KEY, {
            algorithm: "HS256",
            expiresIn: Config.ACCESS_TOKEN_TTL,
        } as SignOptions);
    }

    generateRefreshToken(payload: AuthPayload): string {
        return jwt.sign(payload, Config.SECRET_KEY, {
            algorithm: "HS256",
            expiresIn: Config.REFRESH_TOKEN_TTL,
        } as SignOptions);
    }

    verifyToken(token: string): AuthPayload & JwtPayload {
        return jwt.verify(token, Config.SECRET_KEY) as AuthPayload & JwtPayload;
    }

    hashToken(token: string): string {
        return crypto.createHash("sha256").update(token).digest("hex");
    }

    async persistRefreshToken(
        userId: number,
        token: string,
        metadata: { user_agent?: string; ip_address?: string } = {},
    ): Promise<void> {
        const token_hash = this.hashToken(token);
        const expires_at = new Date(Date.now() + Config.REFRESH_TOKEN_TTL_MS);

        await db.insert(refresh_tokens).values({
            user_id: userId,
            token_hash,
            expires_at,
            user_agent: metadata.user_agent ?? null,
            ip_address: metadata.ip_address ?? null,
        });
    }

    async revokeRefreshToken(token: string): Promise<void> {
        const token_hash = this.hashToken(token);
        await db
            .update(refresh_tokens)
            .set({ is_revoked: true, revoked_at: new Date() })
            .where(eq(refresh_tokens.token_hash, token_hash));
    }

    async revokeAllForUser(userId: number): Promise<void> {
        await db
            .update(refresh_tokens)
            .set({ is_revoked: true, revoked_at: new Date() })
            .where(
                and(eq(refresh_tokens.user_id, userId), eq(refresh_tokens.is_revoked, false)),
            );
    }

    async isRefreshTokenValid(token: string): Promise<boolean> {
        const token_hash = this.hashToken(token);
        const [row] = await db
            .select()
            .from(refresh_tokens)
            .where(eq(refresh_tokens.token_hash, token_hash))
            .limit(1);

        if (!row) return false;
        if (row.is_revoked) return false;
        if (row.expires_at.getTime() < Date.now()) return false;
        return true;
    }
}
