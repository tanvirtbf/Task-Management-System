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
import { attachments } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/attachments/:id/download` (§16 #5). 🔐 any member with
 * read access to the parent task. 302 redirect to a fresh signed GET URL
 * (r2.fake/get in test). supertest does NOT auto-follow, so we assert status 302
 * + the Location header.
 */

const PATH = (id: string) => `/api/v1/attachments/${id}/download`;

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

const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    const insertAtt = async (
        s: { deletedAt?: Date | null; uploadStatus?: "pending" | "complete" } = {},
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
                uploadedBy: user.id,
                uploadStatus: s.uploadStatus ?? "complete",
                deletedAt: s.deletedAt ?? null,
            });
        return id;
    };
    return { ws, user, client, task, insertAtt };
};

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/attachments/:id/download", () => {
    describe("Happy path", () => {
        it("302 redirects to a fresh signed GET URL", async () => {
            const { client, insertAtt } = await seed();
            const id = await insertAtt();
            const res = await client.get(PATH(id));
            expect(res.status).toBe(302);
            expect(res.headers.location).toContain("https://r2.fake/get/");
        });

        it("the Location is a signed URL, not the raw storage_key", async () => {
            const { client, insertAtt } = await seed();
            const id = await insertAtt();
            const res = await client.get(PATH(id));
            expect(res.headers.location).toContain("?sig=");
            expect(res.headers.location).not.toMatch(/^workspaces\//);
        });

        it("each download mints a fresh 302 (idempotent reads)", async () => {
            const { client, insertAtt } = await seed();
            const id = await insertAtt();
            const a = await client.get(PATH(id));
            const b = await client.get(PATH(id));
            expect(a.status).toBe(302);
            expect(b.status).toBe(302);
        });
    });

    describe("Authentication & authorization", () => {
        it("401 with no credentials (read access checked before redirect)", async () => {
            const { insertAtt } = await seed();
            const id = await insertAtt();
            const http = await oneOff();
            const res = await http.get(PATH(id));
            expect(res.status).toBe(401);
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { user, insertAtt } = await seed();
            const id = await insertAtt();
            const expired = signAccess(user, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(PATH(id))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
        });

        it.each(["owner", "admin", "member", "guest"] as Role[])(
            "allows a %s in the workspace to download (302)",
            async (role) => {
                const { client, insertAtt } = await seed(role);
                const id = await insertAtt();
                expect((await client.get(PATH(id))).status).toBe(302);
            },
        );

        it("404 (not 302) when the attachment's task is in another workspace", async () => {
            const a = await seed();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            const taskB = await makeTask({ workspaceId: wsB.id, createdBy: userB.id });
            const bId = fakeId("att");
            await getDb()
                .insert(attachments)
                .values({
                    id: bId,
                    taskId: taskB.id,
                    name: "b.jpg",
                    storageKey: `workspaces/${wsB.id}/attachments/${bId}.jpg`,
                    mimeType: "image/jpeg",
                    sizeBytes: BigInt(1),
                    uploadedBy: userB.id,
                    uploadStatus: "complete",
                });
            const res = await a.client.get(PATH(bId));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("attachment.not_found");
            expect(res.headers.location).toBeUndefined();
        });
    });

    describe("Not-found, validation, cross-cutting", () => {
        it("404 attachment.not_found for a non-existent id", async () => {
            const { client } = await seed();
            const res = await client.get(PATH(fakeId("att")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("attachment.not_found");
        });

        it("404 for a soft-deleted attachment", async () => {
            const { client, insertAtt } = await seed();
            const id = await insertAtt({ deletedAt: new Date() });
            const res = await client.get(PATH(id));
            expect(res.status).toBe(404);
        });

        it("404 for a pending (un-finalised) attachment — no object exists yet", async () => {
            const { client, insertAtt } = await seed();
            const id = await insertAtt({ uploadStatus: "pending" });
            const res = await client.get(PATH(id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("attachment.not_found");
        });

        it("422 when id exceeds 64 chars", async () => {
            const { client } = await seed();
            const res = await client.get(PATH("a".repeat(65)));
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("id");
        });

        it("treats a SQL-injection id as a literal (404, no 500)", async () => {
            const { client } = await seed();
            const res = await client.get(PATH(encodeURIComponent("' OR '1'='1")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("attachment.not_found");
        });

        it("404 route.not_found for POST on the download path", async () => {
            const { client, insertAtt } = await seed();
            const id = await insertAtt();
            const res = await client.post(PATH(id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("?json=1 variant (gap-scan M11 — XHR-friendly fresh URL)", () => {
    it("200 { url } with the same fresh signed URL semantics", async () => {
        const { client, insertAtt } = await seed();
        const id = await insertAtt();
        const res = await client.get(`${PATH(id)}?json=1`);
        expect(res.status).toBe(200);
        expect(res.body.url).toContain("https://r2.fake/get/");
        expect(res.body.url).toContain("?sig=");
    });

    it("plain requests still get the 302 (backward compatible)", async () => {
        const { client, insertAtt } = await seed();
        const id = await insertAtt();
        const res = await client.get(PATH(id));
        expect(res.status).toBe(302);
    });
});
