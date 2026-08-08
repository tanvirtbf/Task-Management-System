import jwt from "jsonwebtoken";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import type { Notification } from "../../src/db/schema";
import {
    makeUser,
    makeWorkspace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { fakeId } from "../../src/utils";
import type { Role } from "../../src/constants";

/**
 * Shared helpers for the §19 Notifications suite. NOT a `*.test.ts` file, so the
 * jest `testMatch` ignores it — it is only imported. No notification factory
 * exists in `test-utils/factories.ts`, so rows are inserted directly here (the
 * same approach `tests/tasks/activity.test.ts` uses for `task_activity`).
 */

export const BASE = "/api/v1/notifications";

/** Workspace + a logged-in user of the given role. */
export const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    return { ws, user, client };
};

export interface NotifSeed {
    userId: string;
    id?: string;
    type?: Notification["type"];
    entityType?: Notification["entityType"];
    entityId?: string;
    actorId?: string | null;
    title?: string;
    body?: string | null;
    isRead?: boolean;
    snoozedUntil?: Date | null;
    deletedAt?: Date | null;
}

/** Insert one `notifications` row directly. Returns its id. */
export const insertNotification = async (s: NotifSeed): Promise<string> => {
    const id = s.id ?? fakeId("ntf");
    await getDb()
        .insert(notifications)
        .values({
            id,
            userId: s.userId,
            type: s.type ?? "assigned",
            entityType: s.entityType ?? "task",
            entityId: s.entityId ?? fakeId("t"),
            actorId: s.actorId === undefined ? null : s.actorId,
            title: s.title ?? "You were assigned a task",
            body: s.body === undefined ? null : s.body,
            isRead: s.isRead ?? false,
            snoozedUntil: s.snoozedUntil ?? null,
            deletedAt: s.deletedAt ?? null,
        });
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
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

/** Pull the ordered list of notification ids out of a feed response body. */
export const idsOf = (body: { data: Array<{ id: string }> }): string[] =>
    body.data.map((r) => r.id);
