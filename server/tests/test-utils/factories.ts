import {
    seedSystemRoles,
    syncPermissionCatalog,
    syncUserSystemRole,
} from "../../src/rbac/bootstrap";
import bcrypt from "bcrypt";
import { getDb } from "../../src/db/client";
import { addUtcDays, dhakaDayOffset, utcDate } from "./dates";
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
    sprints,
    onCallShifts,
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

/**
 * RBAC bootstrap for a test workspace (RBAC_DYNAMIC_PLAN.md P11).
 *
 * Every real deployment has run P3's bootstrap, so a workspace with no roles is
 * a state that cannot exist in production — and a test built on one would show
 * 403s that no user would ever see. These factories therefore reproduce the
 * post-bootstrap state: the catalog (once per process — `permissions` is
 * workspace-independent reference data), the four system roles per workspace,
 * and the matching assignment for each user created.
 */
// Deliberately NOT memoised: several suites reset by truncating every table,
// which empties the catalog. A single batched 56-row upsert is cheap, and
// re-running it is the only way this stays correct under every reset strategy.

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
    await syncPermissionCatalog(db);
    await seedSystemRoles(db, id);
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

    // The assignment that actually carries authority (the `users.role` column
    // above is only its mirror — plan D-6/L13).
    await syncUserSystemRole(db, workspaceId, id, input.role ?? "member");

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
    /**
     * The department head (§ dept review). Also the person a bug report is
     * routed to when nobody is on call, so eng specs set it.
     */
    headUserId?: string | null;
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
    if (input.headUserId !== undefined) values.headUserId = input.headUserId;

    await db.insert(spaces).values(values);
    return {
        id,
        name,
        workspaceId: input.workspaceId,
        createdBy,
        headUserId: input.headUserId ?? null,
    };
};

export interface MakeTaskTypeInput {
    workspaceId: string;
    name?: string;
    /**
     * F29 (ISS-039): the git/planning task fields require a dev type now.
     * Defaults to the schema's `false` — specs exercising branch/PR/story
     * points must say `isDevType: true`, exactly as a real workspace's
     * engineering types are flagged.
     */
    isDevType?: boolean;
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
        isDevType: input.isDevType ?? false,
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

export interface MakeSprintInput {
    workspaceId: string;
    name?: string;
    goal?: string | null;
    startDate?: string; // YYYY-MM-DD
    endDate?: string; // YYYY-MM-DD
    status?: "planned" | "active" | "closed";
    committedPoints?: number;
}

/**
 * Insert a sprint row. `name` is UNIQUE per workspace (`uq_sprints_workspace_name`)
 * and `start_date <= end_date` (`ck_sprints_dates`) — the defaults satisfy both,
 * and the default `name` appends a sequence number so repeated calls never
 * collide. There is no `created_by` column on sprints. Dates are passed as
 * `YYYY-MM-DD` and stored as LOCAL-midnight Dates (Drizzle `date()` mode
 * "date"), matching the serializer's local-component formatting.
 */
export const makeSprint = async (input: MakeSprintInput) => {
    const db = getDb();
    const id = fakeId("spr");
    const seq = nextSeq();
    const name = input.name ?? `Sprint ${seq}`;
    const status = input.status ?? "planned";
    await db.insert(sprints).values({
        id,
        workspaceId: input.workspaceId,
        name,
        goal: input.goal ?? null,
        startDate: utcDate(input.startDate ?? "2026-06-01"),
        endDate: utcDate(input.endDate ?? "2026-06-14"),
        status,
        committedPoints: input.committedPoints ?? 0,
    });
    return { id, name, workspaceId: input.workspaceId, status };
};

export interface MakeOnCallShiftInput {
    workspaceId: string;
    engineerId?: string;
    createdBy?: string;
    /** A Monday. Omit for a window centered on today (covers CURDATE() — the "current" shift). */
    weekStart?: Date;
}

/**
 * Insert an `on_call_shifts` row. `engineer_id` + `created_by` are NOT-NULL FKs
 * to `users.id` (ON DELETE RESTRICT), so an engineer user is made in the same
 * workspace when omitted, and `created_by` defaults to that engineer. Dates are
 * LOCAL-midnight Dates (Drizzle `date()` mode "date", matching `makeSprint` +
 * the serializer's local-component formatting); `week_end` is `week_start + 6`
 * days (satisfies `ck_on_call_shifts_week` start<=end). When `weekStart` is
 * omitted the window is centered on today so the row is the CURRENT shift for
 * GET /on-call/current tests. UNIQUE on (workspace_id, week_start) — reuse a
 * workspace only with distinct `weekStart` values.
 */
export const makeOnCallShift = async (input: MakeOnCallShiftInput) => {
    const db = getDb();
    const id = fakeId("ocs");
    const engineerId =
        input.engineerId ??
        (await makeUser({ workspaceId: input.workspaceId })).id;
    const createdBy = input.createdBy ?? engineerId;

    let weekStart: Date;
    let weekEnd: Date;
    if (input.weekStart) {
        weekStart = input.weekStart;
        weekEnd = addUtcDays(input.weekStart, 6);
    } else {
        // A 7-day window centred on today, so "who is on call now?" always hits.
        weekStart = dhakaDayOffset(-3);
        weekEnd = dhakaDayOffset(3);
    }

    await db.insert(onCallShifts).values({
        id,
        workspaceId: input.workspaceId,
        weekStart,
        weekEnd,
        engineerId,
        createdBy,
    });
    return {
        id,
        workspaceId: input.workspaceId,
        engineerId,
        createdBy,
        weekStart,
        weekEnd,
    };
};
