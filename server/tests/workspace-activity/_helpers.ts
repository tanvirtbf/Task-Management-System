import jwt from "jsonwebtoken";
import { getDb } from "../../src/db/client";
import { workspaceActivity } from "../../src/db/schema";
import type { WorkspaceActivityEntityType } from "../../src/repositories/WorkspaceActivityRepo";
import {
    makeUser,
    makeWorkspace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { fakeId } from "../../src/utils";
import type { Role } from "../../src/constants";

/**
 * Shared helpers for the §26 Workspace-activity suite. NOT a `*.test.ts` file,
 * so jest's `testMatch` ignores it — it is only imported. No factory exists for
 * `workspace_activity`, so rows are inserted directly here. The suite does not
 * truncate between tests, so every id is unique (fakeId) and every test uses a
 * fresh workspace; reads are workspace-scoped.
 */

export const BASE = "/api/v1/activity";

/** Workspace + a logged-in user of the given role. */
export const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    return { ws, user, client };
};

export interface ActivitySeed {
    workspaceId: string;
    id?: string;
    actorId?: string | null;
    entityType?: WorkspaceActivityEntityType;
    entityId?: string;
    action?: string;
    context?: Record<string, unknown> | null;
    createdAt?: Date;
}

/** Insert one `workspace_activity` row directly. Returns its id. */
export const insertActivity = async (s: ActivitySeed): Promise<string> => {
    const id = s.id ?? fakeId("wsa");
    const values: typeof workspaceActivity.$inferInsert = {
        id,
        workspaceId: s.workspaceId,
        actorId: s.actorId === undefined ? null : s.actorId,
        entityType: s.entityType ?? "space",
        entityId: s.entityId ?? fakeId("sp"),
        action: s.action ?? "created",
        context: s.context === undefined ? null : s.context,
    };
    if (s.createdAt !== undefined) values.createdAt = s.createdAt;
    await getDb().insert(workspaceActivity).values(values);
    return id;
};

/** Mint a raw access token for the negative-auth cases. */
export const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", ...opts },
    );

/** Pull the ordered list of activity ids out of a response body. */
export const idsOf = (body: { data: Array<{ id: string }> }): string[] =>
    body.data.map((r) => r.id);

/** The 10 keys of a hydrated wire `User`. */
export const USER_KEYS = [
    "avatar_url",
    "created_at",
    "email",
    "first_name",
    "id",
    "last_login_at",
    "last_name",
    "role",
    "status",
    "timezone",
].sort();
