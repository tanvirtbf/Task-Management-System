import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { attachments, tasks } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import { R2Service } from "../../src/services/R2Service";
import type { Role } from "../../src/constants";

/**
 * Tests for `DELETE /api/v1/attachments/:id` (§16 #4). 🔐 uploader (own) OR 👑
 * owner/admin. SOFT delete (sets deleted_at; the R2 object is left for the daily
 * janitor — NO deleteObject call). Decrements tasks.attachments_count via the
 * trigger. 204.
 */

const PATH = (id: string) => `/api/v1/attachments/${id}`;

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", ...opts },
    );

/**
 * Workspace with a complete attachment uploaded by `uploader`. The returned
 * `client` belongs to `actorRole` (default = the uploader themselves).
 */
const seed = async (opts: { uploaderRole?: Role } = {}) => {
    const ws = await makeWorkspace();
    const uploader = await makeUser({
        workspaceId: ws.id,
        role: opts.uploaderRole ?? "member",
    });
    const task = await makeTask({ workspaceId: ws.id, createdBy: uploader.id });
    const insertAtt = async (
        s: { uploadStatus?: "pending" | "complete"; deletedAt?: Date | null } = {},
    ) => {
        const id = fakeId("att");
        await getDb()
            .insert(attachments)
            .values({
                id,
                taskId: task.id,
                name: "file.jpg",
                storageKey: `workspaces/${ws.id}/attachments/${id}.jpg`,
                mimeType: "image/jpeg",
                sizeBytes: BigInt(2048),
                uploadedBy: uploader.id,
                uploadStatus: s.uploadStatus ?? "complete",
                deletedAt: s.deletedAt ?? null,
            });
        return id;
    };
    return { ws, uploader, task, insertAtt };
};

const clientFor = (user: { id: string; workspaceId: string; role: Role }) =>
    makeLoggedInClient(user);

const rowById = async (id: string) => {
    const [row] = await getDb()
        .select()
        .from(attachments)
        .where(eq(attachments.id, id))
        .limit(1);
    return row;
};
const countOf = async (taskId: string): Promise<number> => {
    const [row] = await getDb()
        .select({ c: tasks.attachmentsCount })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return row.c;
};

// ════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/v1/attachments/:id", () => {
    describe("Happy path", () => {
        it("204 soft-deletes (sets deleted_at, row persists)", async () => {
            const { uploader, insertAtt } = await seed();
            const client = await clientFor(uploader);
            const id = await insertAtt();

            const res = await client.delete(PATH(id));
            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            const row = await rowById(id);
            expect(row).toBeDefined(); // soft delete — row NOT removed
            expect(row.deletedAt).not.toBeNull();
        });

        it("decrements tasks.attachments_count by one", async () => {
            const { uploader, task, insertAtt } = await seed();
            const client = await clientFor(uploader);
            const id = await insertAtt();
            const before = await countOf(task.id); // 1 (complete)
            await client.delete(PATH(id));
            expect(await countOf(task.id)).toBe(before - 1);
        });

        it("does NOT delete the R2 object (deferred to the janitor)", async () => {
            const { uploader, insertAtt } = await seed();
            const client = await clientFor(uploader);
            const id = await insertAtt();
            const delSpy = jest.spyOn(R2Service.prototype, "deleteObject");
            await client.delete(PATH(id));
            expect(delSpy).not.toHaveBeenCalled();
            delSpy.mockRestore();
        });
    });

    describe("Authorization (own / 👑)", () => {
        it("allows the uploader to delete their own (204)", async () => {
            const { uploader, insertAtt } = await seed();
            const client = await clientFor(uploader);
            expect((await client.delete(PATH(await insertAtt()))).status).toBe(204);
        });

        it.each(["owner", "admin"] as Role[])(
            "allows an %s (different user) to delete any (204)",
            async (role) => {
                const { ws, insertAtt } = await seed();
                const admin = await makeUser({ workspaceId: ws.id, role });
                const client = await clientFor(admin);
                expect((await client.delete(PATH(await insertAtt()))).status).toBe(204);
            },
        );

        it("forbids a non-uploader member (403) and leaves the row intact", async () => {
            const { ws, insertAtt } = await seed();
            const other = await makeUser({ workspaceId: ws.id, role: "member" });
            const client = await clientFor(other);
            const id = await insertAtt();
            const res = await client.delete(PATH(id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
            expect((await rowById(id)).deletedAt).toBeNull();
        });

        it("forbids a non-uploader guest (403)", async () => {
            const { ws, insertAtt } = await seed();
            const guest = await makeUser({ workspaceId: ws.id, role: "guest" });
            const client = await clientFor(guest);
            const res = await client.delete(PATH(await insertAtt()));
            expect(res.status).toBe(403);
        });
    });

    describe("Authentication", () => {
        it("401 with no credentials", async () => {
            const { insertAtt } = await seed();
            const id = await insertAtt();
            const http = await oneOff();
            expect((await http.delete(PATH(id))).status).toBe(401);
        });

        it("401 auth.expired_token", async () => {
            const { uploader, insertAtt } = await seed();
            const id = await insertAtt();
            const expired = signAccess(uploader, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .delete(PATH(id))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
        });
    });

    describe("Not-found, idempotency, side-effects", () => {
        it("404 attachment.not_found for a non-existent id", async () => {
            const { uploader } = await seed();
            const client = await clientFor(uploader);
            const res = await client.delete(PATH(fakeId("att")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("attachment.not_found");
        });

        it("a second delete of the same id returns 404 (already deleted)", async () => {
            const { uploader, insertAtt } = await seed();
            const client = await clientFor(uploader);
            const id = await insertAtt();
            expect((await client.delete(PATH(id))).status).toBe(204);
            expect((await client.delete(PATH(id))).status).toBe(404);
        });

        it("two parallel deletes → one 204, one 404", async () => {
            const { uploader, insertAtt } = await seed();
            const client = await clientFor(uploader);
            const id = await insertAtt();
            const [a, b] = await Promise.all([
                client.delete(PATH(id)),
                client.delete(PATH(id)),
            ]);
            expect([a.status, b.status].sort()).toEqual([204, 404]);
        });

        it("404 when the attachment's task is in another workspace", async () => {
            const a = await seed();
            const id = await a.insertAtt();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id, role: "owner" });
            const client = await clientFor(userB);
            const res = await client.delete(PATH(id));
            expect(res.status).toBe(404);
            expect((await rowById(id)).deletedAt).toBeNull();
        });

        it("deleting a pending attachment does not decrement the counter", async () => {
            const { uploader, task, insertAtt } = await seed();
            const client = await clientFor(uploader);
            const id = await insertAtt({ uploadStatus: "pending" });
            const before = await countOf(task.id); // 0 (pending never counted)
            await client.delete(PATH(id));
            expect(await countOf(task.id)).toBe(before);
        });

        it("422 when id exceeds 64 chars", async () => {
            const { uploader } = await seed();
            const client = await clientFor(uploader);
            const res = await client.delete(PATH("a".repeat(65)));
            expect(res.status).toBe(422);
        });
    });
});
