import bcrypt from "bcrypt";
import { getDb } from "../../src/db/client";
import { workspaces, users, sessions } from "../../src/db/schema";
import { TokenService } from "../../src/services/TokenService";
import { fakeId, sha256 } from "../../src/utils";
import type { Role } from "../../src/constants";
import { LoggedInClient } from "./app";
import { getApp } from "./app";

/**
 * Factories for the common rows tests need. Each factory inserts a real row
 * via Drizzle (no mocks) so behaviour mirrors production.
 *
 * Defaults are deterministic enough for assertions but each call generates a
 * fresh ID/email so concurrent tests do not collide.
 */

let _seq = 0;
const nextSeq = () => ++_seq;

export interface MakeWorkspaceInput {
    name?: string;
    timezone?: string;
    defaultLocale?: string;
}

export const makeWorkspace = async (input: MakeWorkspaceInput = {}) => {
    const db = getDb();
    const id = fakeId("ws");
    const seq = nextSeq();
    const name = input.name ?? `Test Workspace ${seq}`;
    await db.insert(workspaces).values({
        id,
        name,
        timezone: input.timezone ?? "Asia/Dhaka",
        defaultLocale: input.defaultLocale ?? "en-US",
    });
    return { id, name };
};

export interface MakeUserInput {
    workspaceId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    password?: string;
    role?: Role;
    status?: "active" | "invited" | "deactivated";
}

/**
 * Create a user. If no workspaceId is supplied a workspace is created too.
 * The plain password is returned so tests can log in with it.
 */
export const makeUser = async (input: MakeUserInput = {}) => {
    const db = getDb();
    const workspaceId =
        input.workspaceId ?? (await makeWorkspace()).id;
    const id = fakeId("u");
    const seq = nextSeq();
    const password = input.password ?? "Pa$$w0rd!";
    const passwordHash = await bcrypt.hash(password, 4);
    const email = input.email ?? `user${seq}-${id.slice(2, 8)}@example.test`;

    await db.insert(users).values({
        id,
        workspaceId,
        firstName: input.firstName ?? "Test",
        lastName: input.lastName ?? `User${seq}`,
        email,
        passwordHash,
        role: input.role ?? "member",
        status: input.status ?? "active",
    });

    return { id, email, password, workspaceId, role: input.role ?? "member" };
};

export interface MakeSessionInput {
    userId: string;
    expiresAt?: Date;
    revokedAt?: Date | null;
}

export const makeSession = async (input: MakeSessionInput) => {
    const db = getDb();
    const id = fakeId("ses");
    const tokenHash = sha256(`raw-${id}`);
    await db.insert(sessions).values({
        id,
        userId: input.userId,
        tokenHash,
        expiresAt:
            input.expiresAt ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
        revokedAt: input.revokedAt ?? null,
    });
    return { id, tokenHash };
};

/**
 * Create an authenticated `LoggedInClient` without going through any login
 * endpoint. The flow uses `TokenService` directly to mint a real access +
 * refresh token, persists a real session row, and wraps the cookies in the
 * same `LoggedInClient` test helper that endpoint-based tests use.
 *
 * Use this in tests for any endpoint that requires `authenticate` middleware
 * — it stays valid even before /auth/login is rebuilt.
 *
 *   const u = await makeUser({ role: "admin" });
 *   const client = await makeLoggedInClient(u);
 *   const res = await client.get("/api/v1/spaces");
 */
export const makeLoggedInClient = async (user: {
    id: string;
    workspaceId: string;
    role: Role;
}): Promise<LoggedInClient> => {
    const app = await getApp();
    const db = getDb();
    const tokens = new TokenService(db);

    const payload = {
        sub: user.id,
        role: user.role,
        workspaceId: user.workspaceId,
    };

    // Persist a real session row and bind the refresh token's `id` claim to it.
    const tempRefresh = tokens.generateRefreshToken({ ...payload, id: "pending" });
    const session = await tokens.persistSession({
        userId: user.id,
        refreshToken: tempRefresh,
    });
    const refreshToken = tokens.generateRefreshToken({
        ...payload,
        id: session.id,
    });
    const accessToken = tokens.generateAccessToken(payload);

    const cookieHeader = [
        `accessToken=${accessToken}; Path=/; HttpOnly`,
        `refreshToken=${refreshToken}; Path=/; HttpOnly`,
    ].join(",");

    return new LoggedInClient(app, cookieHeader);
};
