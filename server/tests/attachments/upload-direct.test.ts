import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { attachments, taskActivity, tasks } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { oneOff } from "../test-utils/app";
import { MAX_ATTACHMENT_BYTES } from "../../src/services/attachmentPolicy";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";

/**
 * `POST /api/v1/tasks/:id/attachments` — the PROXIED upload.
 *
 * This is the endpoint every real upload in this product goes through:
 * `client/src/http/api.ts` posts the raw bytes here with the name in
 * `X-Filename`, and never touches `/uploads/sign` at all. The presign pair has
 * 38 tests. This route had **none** — the only test that so much as named it was
 * the tenant-isolation sweep's cross-workspace probe, which is why the reach
 * mapper counted it as covered. Reached is not tested.
 *
 * So the edge sheet P8 owes (§P8 task 2) is written against THIS path: the
 * declared-vs-sniffed MIME question, the size ceiling at both ends, zero- and
 * one-byte bodies, duplicate and hostile filenames, unicode counted in
 * characters, and the guarantee that the storage key is never built from
 * anything the client said.
 *
 * The 1-hour "uploaded but never finalised" sweep is NOT re-proved here — the
 * proxied path finalises inline, and `tests/jobs/attachment-janitor.test.ts`
 * already owns the presign path's abandoned rows.
 */
jest.setTimeout(60_000);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const seed = async (role: "member" | "guest" | "admin" = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

const upload = (
    client: Awaited<ReturnType<typeof makeLoggedInClient>>,
    taskId: string,
    opts: {
        body?: Buffer;
        contentType?: string | null;
        filename?: string | null;
    } = {},
) => {
    let req = client.post(`/api/v1/tasks/${taskId}/attachments`);
    if (opts.contentType !== null) {
        req = req.set("Content-Type", opts.contentType ?? "image/jpeg");
    }
    if (opts.filename !== null && opts.filename !== undefined) {
        req = req.set("X-Filename", opts.filename);
    }
    return req.send(opts.body ?? JPEG);
};

const rowsForTask = async (taskId: string) =>
    getDb().select().from(attachments).where(eq(attachments.taskId, taskId));

const counterFor = async (taskId: string) => {
    const [row] = await getDb()
        .select({ n: tasks.attachmentsCount })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return row?.n ?? null;
};

describe("POST /tasks/:id/attachments — the shipped upload path", () => {
    describe("Happy path", () => {
        it("201 with the Appendix-A wire shape and a complete row", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, {
                filename: "holiday%20snap.jpg",
            });

            expect(res.status).toBe(201);
            expect(Object.keys(res.body).sort()).toEqual(
                [
                    "id",
                    "mime_type",
                    "name",
                    "size_bytes",
                    "task_id",
                    "thumbnail_url",
                    "uploaded_at",
                    "uploaded_by",
                    "url",
                ].sort(),
            );
            expect(res.body.task_id).toBe(task.id);
            expect(res.body.mime_type).toBe("image/jpeg");
            expect(res.body.size_bytes).toBe(JPEG.length);

            const rows = await rowsForTask(task.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].uploadStatus).toBe("complete");
            expect(rows[0].deletedAt).toBeNull();
        });

        it("URL-decodes X-Filename — the client sends it encoded", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, {
                filename: "holiday%20snap.jpg",
            });
            expect(res.body.name).toBe("holiday snap.jpg");
        });

        it("bumps tasks.attachments_count, once per upload", async () => {
            const { client, task } = await seed();
            expect(await counterFor(task.id)).toBe(0);
            await upload(client, task.id, { filename: "a.jpg" });
            expect(await counterFor(task.id)).toBe(1);
            await upload(client, task.id, { filename: "b.jpg" });
            expect(await counterFor(task.id)).toBe(2);
        });

        it("writes the attachment_added audit row (who put this file here)", async () => {
            const { client, task, user } = await seed();
            const res = await upload(client, task.id, { filename: "a.jpg" });
            const rows = await getDb()
                .select()
                .from(taskActivity)
                .where(
                    and(
                        eq(taskActivity.taskId, task.id),
                        eq(taskActivity.action, "attachment_added"),
                    ),
                );
            expect(rows).toHaveLength(1);
            expect(rows[0].actorId).toBe(user.id);
            expect(JSON.stringify(rows[0].context)).toContain(res.body.id);
        });

        it("the returned url is a signed URL, never the storage key", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, { filename: "a.jpg" });
            const [row] = await rowsForTask(task.id);
            expect(res.body.url).not.toContain(row.storageKey);
            expect(res.body.url).toMatch(/^https:\/\//);
        });
    });

    describe("The filename is a label, never a path", () => {
        it("builds the storage key from the id + MIME, ignoring what the client called the file", async () => {
            const { client, task, ws } = await seed();
            const res = await upload(client, task.id, {
                contentType: "text/plain",
                body: Buffer.from("hello"),
                filename: "../../../../etc/passwd",
            });
            expect(res.status).toBe(201);
            const [row] = await rowsForTask(task.id);
            expect(row.storageKey).toBe(
                `workspaces/${ws.id}/attachments/${res.body.id}.txt`,
            );
            // The hostile string survives as a NAME — it is display text — but
            // it never reached the key, so no upload can escape its workspace
            // prefix or overwrite a neighbour's object.
            expect(row.name).toBe("../../../../etc/passwd");
            expect(row.storageKey).not.toContain("..");
        });

        it("two files with the SAME name are two rows with different keys", async () => {
            const { client, task } = await seed();
            const a = await upload(client, task.id, { filename: "invoice.jpg" });
            const b = await upload(client, task.id, { filename: "invoice.jpg" });
            expect(a.body.id).not.toBe(b.body.id);
            const rows = await rowsForTask(task.id);
            expect(rows).toHaveLength(2);
            expect(new Set(rows.map((r) => r.storageKey)).size).toBe(2);
        });

        it("a Bangla filename round-trips, and the 255 limit counts CHARACTERS", async () => {
            const { client, task } = await seed();
            const bangla = "আমার-ছবি-নভেম্বর.jpg";
            const res = await upload(client, task.id, {
                filename: encodeURIComponent(bangla),
            });
            expect(res.status).toBe(201);
            expect(res.body.name).toBe(bangla);

            // 255 Bangla characters is ~765 bytes. If the limit were counted in
            // bytes this would be refused, and `attachments.name` is
            // varchar(255) — characters — so refusing it would be wrong.
            const long = "ক".repeat(250) + ".jpg"; // 254 chars
            const ok = await upload(client, task.id, {
                filename: encodeURIComponent(long),
            });
            expect(ok.status).toBe(201);
            expect(ok.body.name).toHaveLength(254);
        });

        it("accepts exactly 255 characters and refuses 256", async () => {
            const { client, task } = await seed();
            const at255 = "a".repeat(251) + ".jpg";
            expect(at255).toHaveLength(255);
            const ok = await upload(client, task.id, { filename: at255 });
            expect(ok.status).toBe(201);

            const over = "a".repeat(252) + ".jpg";
            const res = await upload(client, task.id, { filename: over });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("a malformed percent-escape falls back to the raw header, not a 500", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, { filename: "100%.jpg" });
            expect(res.status).toBe(201);
            expect(res.body.name).toBe("100%.jpg");
        });

        it("defaults to 'file' when the header is absent", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, { filename: null });
            expect(res.status).toBe(201);
            expect(res.body.name).toBe("file");
        });

        it("an encoded newline stays DATA — it is stored, not re-emitted as a header", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, {
                filename: encodeURIComponent("first\r\nX-Injected: yes"),
            });
            expect(res.status).toBe(201);
            expect(res.body.name).toBe("first\r\nX-Injected: yes");
            expect(res.headers["x-injected"]).toBeUndefined();
        });
    });

    describe("Size", () => {
        it("400 attachment.empty for a zero-byte body, and writes no row", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, {
                body: Buffer.alloc(0),
                filename: "empty.jpg",
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("attachment.empty");
            expect(await rowsForTask(task.id)).toEqual([]);
        });

        it("accepts a ONE-byte file (the smallest real file there is)", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, {
                contentType: "text/plain",
                body: Buffer.from("x"),
                filename: "one.txt",
            });
            expect(res.status).toBe(201);
            expect(res.body.size_bytes).toBe(1);
        });

        it("413 above 25 MB, measured on the REAL bytes not a declared size", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, {
                contentType: "text/plain",
                body: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61),
                filename: "big.txt",
            });
            expect(res.status).toBe(413);
            expect(res.body.error.code).toBe("attachment.too_large");
            expect(await rowsForTask(task.id)).toEqual([]);
        });
    });

    describe("MIME", () => {
        it("takes the type from Content-Type and strips the charset", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, {
                contentType: "text/plain; charset=utf-8",
                body: Buffer.from("hi"),
                filename: "n.txt",
            });
            expect(res.status).toBe(201);
            expect(res.body.mime_type).toBe("text/plain");
        });

        it("415 for a type outside the allow-list, and writes no row", async () => {
            const { client, task } = await seed();
            const res = await upload(client, task.id, {
                contentType: "application/x-msdownload",
                body: Buffer.from([0x4d, 0x5a]),
                filename: "setup.exe",
            });
            expect(res.status).toBe(415);
            expect(res.body.error.code).toBe("attachment.mime_not_allowed");
            expect(await rowsForTask(task.id)).toEqual([]);
        });

        it("415 for SVG and HTML — the two stored-XSS shapes — even though they are 'images'/'text'", async () => {
            const { client, task } = await seed();
            for (const type of ["image/svg+xml", "text/html"]) {
                const res = await upload(client, task.id, {
                    contentType: type,
                    body: Buffer.from("<svg onload=alert(1)>"),
                    filename: "x",
                });
                expect(res.status).toBe(415);
            }
        });

        it("does NOT sniff: a PNG declared text/plain is stored as .txt", async () => {
            // Recorded rather than fixed. The server trusts the declared type,
            // and the storage extension follows the DECLARATION, not the bytes.
            // That is safe here only because the allow-list contains no type a
            // browser will execute — no SVG, no HTML, no JS — so a lie about
            // the type can downgrade how a file is served but never escalate it.
            // If a dangerous type is ever allow-listed, magic-byte sniffing
            // stops being optional.
            const { client, task, ws } = await seed();
            const res = await upload(client, task.id, {
                contentType: "text/plain",
                body: PNG,
                filename: "actually-a-png.txt",
            });
            expect(res.status).toBe(201);
            expect(res.body.mime_type).toBe("text/plain");
            const [row] = await rowsForTask(task.id);
            expect(row.storageKey).toBe(
                `workspaces/${ws.id}/attachments/${res.body.id}.txt`,
            );
        });

        it("400, not 500, when the bytes arrive labelled application/json", async () => {
            // The app-level `express.json()` runs before this route's
            // `express.raw`, so a JSON label means the body is parsed as JSON
            // and never reaches the controller as a Buffer. The controller has
            // to notice that rather than hand a plain object to the service.
            const { client, task } = await seed();
            const res = await client
                .post(`/api/v1/tasks/${task.id}/attachments`)
                .set("Content-Type", "application/json")
                .set("X-Filename", "sneaky.json")
                .send({ not: "a file" });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("attachment.empty");
            expect(await rowsForTask(task.id)).toEqual([]);
        });

        it("415 when no Content-Type is sent at all (application/octet-stream)", async () => {
            const { client, task } = await seed();
            const res = await client
                .post(`/api/v1/tasks/${task.id}/attachments`)
                .set("X-Filename", "blob")
                .set("Content-Type", "application/octet-stream")
                .send(JPEG);
            expect(res.status).toBe(415);
        });
    });

    describe("Authorization", () => {
        it("401 with no credentials", async () => {
            const { task } = await seed();
            const res = await (await oneOff())
                .post(`/api/v1/tasks/${task.id}/attachments`)
                .set("Content-Type", "image/jpeg")
                .set("X-Filename", "a.jpg")
                .send(JPEG);
            expect(res.status).toBe(401);
        });

        it("403 for a guest, and writes no row", async () => {
            const ws = await makeWorkspace();
            const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
            const task = await makeTask({
                workspaceId: ws.id,
                createdBy: owner.id,
            });
            const guest = await makeUser({ workspaceId: ws.id, role: "guest" });
            const client = await makeLoggedInClient(guest);
            const res = await upload(client, task.id, { filename: "a.jpg" });
            expect(res.status).toBe(403);
            expect(await rowsForTask(task.id)).toEqual([]);
        });

        it("404 for a task that does not exist", async () => {
            const { client } = await seed();
            const res = await upload(client, fakeId("t"), { filename: "a.jpg" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("404 for a task in another workspace — no write across tenants", async () => {
            const { client } = await seed();
            const other = await makeWorkspace();
            const otherUser = await makeUser({
                workspaceId: other.id,
                role: "member",
            });
            const otherTask = await makeTask({
                workspaceId: other.id,
                createdBy: otherUser.id,
            });
            const res = await upload(client, otherTask.id, {
                filename: "a.jpg",
            });
            expect(res.status).toBe(404);
            expect(await rowsForTask(otherTask.id)).toEqual([]);
        });
    });

    describe("Round trip", () => {
        it("an uploaded file is immediately listable and downloadable", async () => {
            const { client, task } = await seed();
            const up = await upload(client, task.id, { filename: "a.jpg" });
            expect(up.status).toBe(201);

            const list = await client.get(`/api/v1/tasks/${task.id}/attachments`);
            expect(list.status).toBe(200);
            expect(list.body.map((a: { id: string }) => a.id)).toContain(
                up.body.id,
            );

            const dl = await client.get(
                `/api/v1/attachments/${up.body.id}/download?json=1`,
            );
            expect(dl.status).toBe(200);
            expect(dl.body.url).toMatch(/^https:\/\//);
        });

        it("deleting it decrements the counter and drops it from the list", async () => {
            const { client, task } = await seed();
            const up = await upload(client, task.id, { filename: "a.jpg" });
            expect(await counterFor(task.id)).toBe(1);

            const del = await client.delete(`/api/v1/attachments/${up.body.id}`);
            expect(del.status).toBe(204);
            expect(await counterFor(task.id)).toBe(0);

            const list = await client.get(`/api/v1/tasks/${task.id}/attachments`);
            expect(list.body).toEqual([]);
        });
    });
});
