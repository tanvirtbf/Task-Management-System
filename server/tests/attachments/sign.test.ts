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
 * Tests for `POST /api/v1/uploads/sign` (§16 #1). 🔐 + rate-limited. Validates
 * size (≤25 MB → 413) + MIME (allow-list → 415) + scope (task in workspace →
 * 404, guest → 403) BEFORE signing, inserts the PENDING row, and returns 201
 * with a signed PUT URL. In test mode R2Service is the no-network stub
 * (presignPut → https://r2.fake/put/...), so no bucket is touched.
 */

const PATH = "/api/v1/uploads/sign";

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

const body = (over: Record<string, unknown> = {}) => ({
    scope_type: "task",
    scope_id: "REPLACED",
    filename: "damage-photo.jpg",
    mime_type: "image/jpeg",
    size_bytes: 1_843_200,
    ...over,
});

const rowsForTask = async (taskId: string) =>
    getDb().select().from(attachments).where(eq(attachments.taskId, taskId));
const attachmentsCount = async (taskId: string): Promise<number> => {
    const [row] = await getDb()
        .select({ c: tasks.attachmentsCount })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return row.c;
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/uploads/sign", () => {
    describe("Happy path", () => {
        it("201 with a signed PUT url + attachment id + expires_in", async () => {
            const { client, task } = await seed();
            const res = await client.post(PATH).send(body({ scope_id: task.id }));

            expect(res.status).toBe(201);
            expect(res.body.attachment_id).toMatch(/^att-/);
            expect(res.body.upload_url).toContain("https://r2.fake/put/");
            expect(res.body.expires_in).toBe(900);
            expect(res.body.fields["Content-Type"]).toBe("image/jpeg");
        });

        it("creates exactly one PENDING attachment row", async () => {
            const { client, task } = await seed();
            await client.post(PATH).send(body({ scope_id: task.id }));

            const rows = await rowsForTask(task.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].uploadStatus).toBe("pending");
            expect(rows[0].name).toBe("damage-photo.jpg");
            expect(rows[0].mimeType).toBe("image/jpeg");
            expect(Number(rows[0].sizeBytes)).toBe(1_843_200);
            expect(rows[0].storageKey).toContain("attachments/");
        });

        it("does NOT bump tasks.attachments_count while pending", async () => {
            const { client, task } = await seed();
            const before = await attachmentsCount(task.id);
            await client.post(PATH).send(body({ scope_id: task.id }));
            expect(await attachmentsCount(task.id)).toBe(before); // still 0
        });

        it("resolves the scope task by custom_id too", async () => {
            const { client, task } = await seed();
            await getDb()
                .update(tasks)
                .set({ customId: "BUG-9" })
                .where(eq(tasks.id, task.id));
            const res = await client.post(PATH).send(body({ scope_id: "BUG-9" }));
            expect(res.status).toBe(201);
        });
    });

    describe("Validation", () => {
        it.each([
            ["scope_type missing", { scope_type: undefined }],
            ["scope_id missing", { scope_id: undefined }],
            ["filename missing", { filename: undefined }],
            ["filename not a string", { filename: 123 }],
            ["mime_type missing", { mime_type: undefined }],
            ["size_bytes zero", { size_bytes: 0 }],
            ["size_bytes negative", { size_bytes: -5 }],
            ["size_bytes non-int", { size_bytes: "big" }],
        ])("422 when %s", async (_label, over) => {
            const { client, task } = await seed();
            const res = await client
                .post(PATH)
                .send(body({ scope_id: task.id, ...over }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("Upload policy (reject before signing)", () => {
        it("413 attachment.too_large when size_bytes > 25 MB", async () => {
            const { client, task } = await seed();
            const res = await client
                .post(PATH)
                .send(body({ scope_id: task.id, size_bytes: 25 * 1024 * 1024 + 1 }));
            expect(res.status).toBe(413);
            expect(res.body.error.code).toBe("attachment.too_large");
        });

        it("accepts exactly 25 MB (201)", async () => {
            const { client, task } = await seed();
            const res = await client
                .post(PATH)
                .send(body({ scope_id: task.id, size_bytes: 25 * 1024 * 1024 }));
            expect(res.status).toBe(201);
        });

        it("415 attachment.mime_not_allowed for a disallowed MIME", async () => {
            const { client, task } = await seed();
            const res = await client
                .post(PATH)
                .send(body({ scope_id: task.id, mime_type: "application/x-msdownload" }));
            expect(res.status).toBe(415);
            expect(res.body.error.code).toBe("attachment.mime_not_allowed");
        });

        it("400 attachment.scope_unsupported for a non-task scope_type", async () => {
            const { client, task } = await seed();
            const res = await client
                .post(PATH)
                .send(body({ scope_id: task.id, scope_type: "space" }));
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("attachment.scope_unsupported");
        });

        it("writes NO row and never presigns on a policy rejection", async () => {
            const { client, task } = await seed();
            const putSpy = jest.spyOn(R2Service.prototype, "presignPut");
            await client
                .post(PATH)
                .send(body({ scope_id: task.id, mime_type: "application/zip" }));
            expect(putSpy).not.toHaveBeenCalled();
            expect(await rowsForTask(task.id)).toHaveLength(0);
            putSpy.mockRestore();
        });

        it("404 task.not_found wins over 413/415 for a missing task with a bad payload", async () => {
            const { client } = await seed();
            const res = await client.post(PATH).send(
                body({
                    scope_id: fakeId("t"),
                    mime_type: "application/x-msdownload",
                    size_bytes: 26 * 1024 * 1024,
                }),
            );
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("derives the storage-key extension from the MIME type, not the filename", async () => {
            const { client, task } = await seed();
            const res = await client.post(PATH).send(
                body({
                    scope_id: task.id,
                    filename: "photo.heic.exe",
                    mime_type: "application/pdf",
                }),
            );
            expect(res.status).toBe(201);
            const rows = await rowsForTask(task.id);
            expect(rows[0].storageKey).toMatch(/\.pdf$/);
            expect(rows[0].storageKey).not.toContain("exe");
        });
    });

    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const { task } = await seed();
            const http = await oneOff();
            const res = await http.post(PATH).send(body({ scope_id: task.id }));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired access token", async () => {
            const { user, task } = await seed();
            const expired = signAccess(user, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .post(PATH)
                .set("Authorization", `Bearer ${expired}`)
                .send(body({ scope_id: task.id }));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Authorization", () => {
        it.each(["owner", "admin", "member"] as Role[])(
            "allows a %s to sign (201)",
            async (role) => {
                const { client, task } = await seed(role);
                const res = await client
                    .post(PATH)
                    .send(body({ scope_id: task.id }));
                expect(res.status).toBe(201);
            },
        );

        it("forbids a guest (403 auth.forbidden) and writes no row", async () => {
            const { client, task } = await seed("guest");
            const res = await client.post(PATH).send(body({ scope_id: task.id }));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
            expect(await rowsForTask(task.id)).toHaveLength(0);
        });
    });

    describe("Not-found & tenant isolation", () => {
        it("404 task.not_found for a non-existent scope task", async () => {
            const { client } = await seed();
            const res = await client
                .post(PATH)
                .send(body({ scope_id: fakeId("t") }));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("404 when the scope task is in another workspace (no write across tenants)", async () => {
            const a = await seed();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            const taskB = await makeTask({ workspaceId: wsB.id, createdBy: userB.id });

            const res = await a.client.post(PATH).send(body({ scope_id: taskB.id }));
            expect(res.status).toBe(404);
            expect(await rowsForTask(taskB.id)).toHaveLength(0);
        });
    });

    describe("Boundary & cross-cutting", () => {
        it("round-trips a unicode filename", async () => {
            const { client, task } = await seed();
            const filename = "অর্ডার ছবি 🎁.png";
            const res = await client
                .post(PATH)
                .send(body({ scope_id: task.id, filename, mime_type: "image/png" }));
            expect(res.status).toBe(201);
            const rows = await rowsForTask(task.id);
            expect(rows[0].name).toBe(filename);
        });

        it("echoes a client X-Request-Id", async () => {
            const { client, task } = await seed();
            const res = await client
                .post(PATH)
                .set("X-Request-Id", "rid-sign-1")
                .send(body({ scope_id: task.id }));
            expect(res.get("x-request-id")).toBe("rid-sign-1");
        });
    });
});
