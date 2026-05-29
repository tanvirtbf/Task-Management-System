import bcrypt from "bcrypt";
import { getDb } from "../../src/db/client";
import { workspaces, users, sessions } from "../../src/db/schema";
import { fakeId, sha256 } from "../../src/utils";
import type { Role } from "../../src/constants";

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
