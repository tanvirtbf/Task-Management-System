import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { attachments } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { storageMode } from "../../src/config/storage";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";

/**
 * KI-19 — the upload that succeeds and stores nothing.
 *
 * `R2Service` falls back to a deterministic no-network stub when the
 * `CLOUDFLARE_R2_*` credentials are absent. In dev that is the point. In
 * production it was a silent data-loss bug, and specifically on the ONE path
 * the shipped client uses: `client/src/http/api.ts` uploads through
 * `POST /tasks/:id/attachments`, whose service calls `R2Service.putObject` —
 * a no-op under the stub. The row was then marked `complete`, the API answered
 * **201 with a plausible `https://r2.fake/...` URL**, and the file appeared on
 * the task. The bytes were never anywhere.
 *
 * The fix makes the stub a decision instead of a fallback (`config/storage.ts`),
 * and every R2 call refuse loudly — `503 storage.unavailable` — when fakes are
 * not acceptable. This suite proves the refusal, and proves the two things a
 * refusal must not do: leave a phantom row behind, and outrank an authorization
 * answer.
 *
 * `STORAGE_ALLOW_STUB=0` asks the production question without setting
 * `NODE_ENV=prod`, which is the trap §A rule 4 documents (MailService would pick
 * a real SMTP transport and this project's dev mailer reaches real people).
 */
jest.setTimeout(60_000);

const seed = async () => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

const insertAttachment = async (
    taskId: string,
    workspaceId: string,
    uploadedBy: string,
    uploadStatus: "pending" | "complete" = "complete",
) => {
    const id = fakeId("att");
    await getDb()
        .insert(attachments)
        .values({
            id,
            taskId,
            name: "already-here.jpg",
            storageKey: `workspaces/${workspaceId}/attachments/${id}.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: BigInt(1024),
            uploadedBy,
            uploadStatus,
        });
    return id;
};

const rowsForTask = async (taskId: string) =>
    getDb().select().from(attachments).where(eq(attachments.taskId, taskId));

const withoutStub = <T>(fn: () => Promise<T>): (() => Promise<T>) => {
    return async () => {
        const prev = process.env.STORAGE_ALLOW_STUB;
        process.env.STORAGE_ALLOW_STUB = "0";
        try {
            return await fn();
        } finally {
            if (prev === undefined) delete process.env.STORAGE_ALLOW_STUB;
            else process.env.STORAGE_ALLOW_STUB = prev;
        }
    };
};

describe("config/storage — the mode is a decision, not a side effect", () => {
    it("is 'stub' by default under NODE_ENV=test (never 'live', even with real credentials in .env)", () => {
        expect(storageMode()).toBe("stub");
    });

    it(
        "is 'unavailable' when the stub is refused",
        withoutStub(async () => {
            expect(storageMode()).toBe("unavailable");
        }),
    );
});

describe("KI-19 — storage unavailable: every path fails loudly", () => {
    // ─── the path the shipped client actually uses ──────────────────────────
    describe("POST /tasks/:id/attachments (proxied upload)", () => {
        it("used to answer 201 with a fake URL; now 503 storage.unavailable", async () => {
            const { client, task } = await seed();

            // Control first: with the stub allowed this is the 201 that used to
            // happen in production too, fake URL and all.
            const ok = await client
                .post(`/api/v1/tasks/${task.id}/attachments`)
                .set("Content-Type", "image/jpeg")
                .set("X-Filename", "holiday.jpg")
                .send(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
            expect(ok.status).toBe(201);
            expect(ok.body.url).toContain("https://r2.fake/");

            await withoutStub(async () => {
                const res = await client
                    .post(`/api/v1/tasks/${task.id}/attachments`)
                    .set("Content-Type", "image/jpeg")
                    .set("X-Filename", "holiday.jpg")
                    .send(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
                expect(res.status).toBe(503);
                expect(res.body.error.code).toBe("storage.unavailable");
            })();
        });

        it(
            "leaves NO row behind — a refusal must not create a phantom attachment",
            withoutStub(async () => {
                const { client, task } = await seed();
                const res = await client
                    .post(`/api/v1/tasks/${task.id}/attachments`)
                    .set("Content-Type", "image/png")
                    .set("X-Filename", "x.png")
                    .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
                expect(res.status).toBe(503);
                expect(await rowsForTask(task.id)).toEqual([]);
            }),
        );

        it(
            "does not outrank authorization — an unreachable task is still 404",
            withoutStub(async () => {
                const { client } = await seed();
                const res = await client
                    .post(`/api/v1/tasks/${fakeId("tsk")}/attachments`)
                    .set("Content-Type", "image/png")
                    .set("X-Filename", "x.png")
                    .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe("task.not_found");
            }),
        );

        it(
            "does not outrank the upload policy — a banned MIME is still 415",
            withoutStub(async () => {
                const { client, task } = await seed();
                const res = await client
                    .post(`/api/v1/tasks/${task.id}/attachments`)
                    .set("Content-Type", "application/x-msdownload")
                    .set("X-Filename", "setup.exe")
                    .send(Buffer.from([0x4d, 0x5a]));
                expect(res.status).toBe(415);
                expect(res.body.error.code).toBe("attachment.mime_not_allowed");
            }),
        );
    });

    // ─── the presign path (still reachable by API clients) ──────────────────
    describe("POST /uploads/sign", () => {
        it(
            "503 storage.unavailable, and no pending row is created",
            withoutStub(async () => {
                const { client, task } = await seed();
                const res = await client.post("/api/v1/uploads/sign").send({
                    scope_type: "task",
                    scope_id: task.id,
                    filename: "report.pdf",
                    mime_type: "application/pdf",
                    size_bytes: 2048,
                });
                expect(res.status).toBe(503);
                expect(res.body.error.code).toBe("storage.unavailable");
                expect(await rowsForTask(task.id)).toEqual([]);
            }),
        );
    });

    describe("POST /attachments/:id/finalize", () => {
        it(
            "cannot confirm what it cannot see — 503 instead of a fake HEAD",
            withoutStub(async () => {
                const { ws, user, task, client } = await seed();
                const id = await insertAttachment(
                    task.id,
                    ws.id,
                    user.id,
                    "pending",
                );
                const res = await client
                    .post(`/api/v1/attachments/${id}/finalize`)
                    .send({});
                expect(res.status).toBe(503);
                expect(res.body.error.code).toBe("storage.unavailable");

                // And the row is still pending — the janitor will sweep it.
                const [row] = await getDb()
                    .select()
                    .from(attachments)
                    .where(eq(attachments.id, id));
                expect(row.uploadStatus).toBe("pending");
            }),
        );
    });

    // ─── reads: a dead link is a lie too ────────────────────────────────────
    describe("reads", () => {
        it(
            "GET /attachments/:id/download is 503, not a redirect to nowhere",
            withoutStub(async () => {
                const { ws, user, task, client } = await seed();
                const id = await insertAttachment(task.id, ws.id, user.id);
                const res = await client.get(
                    `/api/v1/attachments/${id}/download`,
                );
                expect(res.status).toBe(503);
                expect(res.body.error.code).toBe("storage.unavailable");
            }),
        );

        it(
            "GET /tasks/:id/attachments is 503 rather than a list of dead URLs",
            withoutStub(async () => {
                const { ws, user, task, client } = await seed();
                await insertAttachment(task.id, ws.id, user.id);
                const res = await client.get(
                    `/api/v1/tasks/${task.id}/attachments`,
                );
                expect(res.status).toBe(503);
                expect(res.body.error.code).toBe("storage.unavailable");
            }),
        );
    });

    // ─── and the rest of the product keeps working ──────────────────────────
    it(
        "does not take the task itself down — only the bytes are unavailable",
        withoutStub(async () => {
            const { client, task } = await seed();
            const res = await client.get(`/api/v1/tasks/${task.id}`);
            expect(res.status).toBe(200);
        }),
    );
});
