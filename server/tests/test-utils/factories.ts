import bcrypt from "bcrypt";
import { getDb } from "../../src/db/client";
import {
    workspaces,
    users,
    sessions,
    spaces,
    lists,
    tags,
    taskTypes,
    statuses,
    tasks,
} from "../../src/db/schema";
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

export interface MakeTagInput {
    workspaceId: string;
    name?: string;
    color?: string;
}

/**
 * Insert a tag row in the given workspace. `name` is UNIQUE per workspace
 * (`uq_tags_workspace_name`); the default appends a sequence number so repeated
 * calls never collide. Omit `color` to exercise the schema default (#94A3B8).
 */
export const makeTag = async (input: MakeTagInput) => {
    const db = getDb();
    const id = fakeId("tag");
    const seq = nextSeq();
    const name = input.name ?? `Tag ${seq}`;
    const values: { id: string; workspaceId: string; name: string; color?: string } = {
        id,
        workspaceId: input.workspaceId,
        name,
    };
    if (input.color !== undefined) values.color = input.color;
    await db.insert(tags).values(values);
    return { id, name, color: input.color ?? "#94A3B8", workspaceId: input.workspaceId };
};

export interface MakeSpaceInput {
    workspaceId: string;
    createdBy?: string;
    name?: string;
    description?: string | null;
    icon?: string;
    color?: string;
    isPrivate?: boolean;
    position?: number;
    archivedAt?: Date | null;
}

/**
 * Insert a space row in the given workspace. `created_by` references
 * `users.id` (`ON DELETE RESTRICT`), so a creator user is made in the same
 * workspace when one is not supplied — pass `createdBy` to avoid the extra
 * (bcrypt-bearing) user insert in bulk / perf tests. Omit `icon` / `color` to
 * exercise the schema defaults ('Folder' / '#4F46E5').
 */
export const makeSpace = async (input: MakeSpaceInput) => {
    const db = getDb();
    const id = fakeId("sp");
    const seq = nextSeq();
    const createdBy =
        input.createdBy ??
        (await makeUser({ workspaceId: input.workspaceId })).id;
    const name = input.name ?? `Space ${seq}`;

    const values: typeof spaces.$inferInsert = {
        id,
        workspaceId: input.workspaceId,
        name,
        createdBy,
        isPrivate: input.isPrivate ?? false,
        position: input.position ?? 0,
        archivedAt: input.archivedAt ?? null,
    };
    if (input.description !== undefined) values.description = input.description;
    if (input.icon !== undefined) values.icon = input.icon;
    if (input.color !== undefined) values.color = input.color;

    await db.insert(spaces).values(values);
    return { id, name, workspaceId: input.workspaceId, createdBy };
};

export interface MakeTaskTypeInput {
    workspaceId: string;
    name?: string;
}

/** Insert a workspace-scoped task type. `name` is UNIQUE per workspace. */
export const makeTaskType = async (input: MakeTaskTypeInput) => {
    const db = getDb();
    const id = fakeId("tt");
    const seq = nextSeq();
    await db.insert(taskTypes).values({
        id,
        workspaceId: input.workspaceId,
        name: input.name ?? `Type ${seq}`,
    });
    return { id, workspaceId: input.workspaceId };
};

export interface MakeListInput {
    workspaceId: string;
    spaceId?: string;
    createdBy?: string;
    name?: string;
}

/**
 * Insert a list. A parent space + creator user are made in the same workspace
 * when omitted (`space_id` / `created_by` are NOT-NULL FKs).
 */
export const makeList = async (input: MakeListInput) => {
    const db = getDb();
    const createdBy =
        input.createdBy ??
        (await makeUser({ workspaceId: input.workspaceId })).id;
    const spaceId =
        input.spaceId ??
        (await makeSpace({ workspaceId: input.workspaceId, createdBy })).id;
    const id = fakeId("l");
    const seq = nextSeq();
    await db.insert(lists).values({
        id,
        spaceId,
        name: input.name ?? `List ${seq}`,
        createdBy,
    });
    return { id, spaceId, workspaceId: input.workspaceId, createdBy };
};

export type StatusGroup = "not_started" | "active" | "done" | "closed";

export interface MakeStatusInput {
    /** A list id — statuses are list-scoped in V1. */
    scopeId: string;
    statusGroup?: StatusGroup;
    name?: string;
}

/** Insert a list-scoped status. UNIQUE on (scope_type, scope_id, name). */
export const makeStatus = async (input: MakeStatusInput) => {
    const db = getDb();
    const id = fakeId("st");
    const seq = nextSeq();
    await db.insert(statuses).values({
        id,
        scopeType: "list",
        scopeId: input.scopeId,
        name: input.name ?? `Status ${seq}`,
        statusGroup: input.statusGroup ?? "not_started",
    });
    return { id };
};

export interface MakeTaskInput {
    workspaceId: string;
    createdBy?: string;
    listId?: string;
    statusId?: string;
    taskTypeId?: string;
    name?: string;
    archivedAt?: Date | null;
}

/**
 * Create a task, materialising any missing parent rows (creator → space → list,
 * task type, status) in the same workspace. Returns the ids a caller needs for
 * assertions. Pass `archivedAt` to exercise the soft-delete guard.
 */
export const makeTask = async (input: MakeTaskInput) => {
    const db = getDb();
    const workspaceId = input.workspaceId;
    const createdBy =
        input.createdBy ?? (await makeUser({ workspaceId })).id;
    const listId =
        input.listId ?? (await makeList({ workspaceId, createdBy })).id;
    const taskTypeId =
        input.taskTypeId ?? (await makeTaskType({ workspaceId })).id;
    const statusId =
        input.statusId ?? (await makeStatus({ scopeId: listId })).id;
    const id = fakeId("t");
    const seq = nextSeq();
    await db.insert(tasks).values({
        id,
        workspaceId,
        primaryListId: listId,
        taskNumber: seq,
        name: input.name ?? `Task ${seq}`,
        statusId,
        taskTypeId,
        createdBy,
        archivedAt: input.archivedAt ?? null,
    });
    return { id, workspaceId, listId, statusId, taskTypeId, createdBy };
};
