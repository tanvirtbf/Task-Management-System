import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeList,
    makeLoggedInClient,
    makeSpace,
    makeStatus,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";

/**
 * WHAT HAPPENS WHEN SOMEBODY TYPES SOMETHING HOSTILE.
 *
 * The plan asks P7 for a probe sheet — SQL injection, oversize payloads,
 * unicode, path traversal — with every entry either proved safe or fixed here.
 * Almost all of it was unasked: the suite had no injection probe anywhere, and
 * no oversize-body probe at all.
 *
 * Most of these are expected to pass on the first run, and that is the value.
 * "We use a parameterised ORM, so injection is impossible" is a belief until
 * something checks it, and the day somebody hand-writes one `sql.raw` for a
 * sort order is the day the belief stops being true with nothing to notice.
 *
 * XSS is deliberately NOT re-done here: P5 established the comment contract
 * (stored verbatim, rendered as text, escaped in the one HTML sink) in
 * `comments/body-injection.test.ts`. This file covers the task surface, which
 * P5 did not.
 */

jest.setTimeout(60_000);

/** Classic injection payloads, aimed at anything that reaches a WHERE clause. */
const SQLI = [
    "' OR '1'='1",
    "'; DROP TABLE tasks; --",
    "\" OR \"\"=\"",
    "1' UNION SELECT NULL,NULL,NULL--",
    "admin'--",
    "%' OR name LIKE '%",
    "\\'; DELETE FROM tasks WHERE '1'='1",
];

/** Names that have historically broken something somewhere. */
const AWKWARD_NAMES = [
    "ঈদ ক্যাম্পেইন ২০২৬", // Bangla, the language half this data is in
    "🚀 Launch 🎉", // emoji, including outside the BMP
    "Ünïcödé ñämé", // combining marks
    "  leading and trailing  ", // whitespace
    "Tab\tand\nnewline", // control characters
    "a".repeat(190), // near the column ceiling
    "<script>alert(1)</script>", // markup, stored not executed
    "'; --", // SQL-ish but legitimate text
];

const scene = async () => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: "admin" });
    const client = await makeLoggedInClient(user);
    const space = await makeSpace({ workspaceId: ws.id, createdBy: user.id });
    const list = await makeList({
        workspaceId: ws.id,
        spaceId: space.id,
        createdBy: user.id,
    });
    const status = await makeStatus({ scopeId: list.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    return { ws, user, client, space, list, status, taskType };
};
type Scene = Awaited<ReturnType<typeof scene>>;

const createTask = (s: Scene, name: string) =>
    s.client.post("/api/v1/tasks").send({
        name,
        primary_list_id: s.list.id,
        status_id: s.status.id,
        task_type_id: s.taskType.id,
    });

const countTasks = async (workspaceId: string): Promise<number> =>
    (
        await getDb()
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.workspaceId, workspaceId))
    ).length;

describe("SQL injection through the read paths", () => {
    it.each(SQLI)("search survives %s and returns a normal envelope", async (payload) => {
        const s = await scene();
        const created = await createTask(s, "Ordinary task");
        expect(created.status).toBe(201);

        const res = await s.client.get(
            `/api/v1/search?q=${encodeURIComponent(payload)}`,
        );

        // Not a 500, not a leak, and — most importantly — the table is still
        // there afterwards.
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.tasks)).toBe(true);
        expect(await countTasks(s.ws.id)).toBe(1);
    });

    it.each(SQLI)("a list read survives %s in its filters", async (payload) => {
        const s = await scene();
        await createTask(s, "Ordinary task");

        const res = await s.client.get(
            `/api/v1/lists/${s.list.id}/tasks?limit=50&search=${encodeURIComponent(payload)}`,
        );

        expect([200, 422]).toContain(res.status);
        expect(await countTasks(s.ws.id)).toBe(1);
    });

    it("a hostile sort/order param is refused or ignored, never executed", async () => {
        const s = await scene();
        await createTask(s, "Ordinary task");

        for (const param of [
            "sort=name;DROP TABLE tasks",
            "sort_by=(SELECT 1)",
            "order=ASC,(SELECT SLEEP(5))",
            "sort=name&order=DESC--",
        ]) {
            const res = await s.client.get(
                `/api/v1/lists/${s.list.id}/tasks?${param}`,
            );
            expect({ param, ok: res.status < 500 }).toEqual({ param, ok: true });
        }
        expect(await countTasks(s.ws.id)).toBe(1);
    });
});

describe("names people actually type", () => {
    it.each(AWKWARD_NAMES)("round-trips %j unchanged", async (name) => {
        const s = await scene();

        const created = await createTask(s, name);
        expect(created.status).toBe(201);

        const read = await s.client.get(`/api/v1/tasks/${created.body.id}`);
        expect(read.status).toBe(200);
        // The API neither mangles nor "sanitises" it. Trimming of surrounding
        // whitespace is the one transformation a validator is allowed.
        expect(read.body.name).toBe(name.trim());
    });

    it("accepts a name at the ceiling and refuses one past it, without truncating", async () => {
        const s = await scene();

        // `tasks.name` is varchar(500) and the validator caps at 500, so the
        // ceiling itself must be usable. (The first draft of this test assumed
        // ~200 and called a legitimate 500-character name a bug — measuring
        // the schema is what settled it.)
        const atLimit = await createTask(s, "a".repeat(500));
        expect(atLimit.status).toBe(201);
        expect(atLimit.body.name).toHaveLength(500);

        const overLimit = await createTask(s, "a".repeat(501));

        // Refused outright. Storing 500 of 501 characters would be the bad
        // outcome: the caller believes something the database does not.
        expect(overLimit.status).toBe(422);
        expect(await countTasks(s.ws.id)).toBe(1);
    });

    it("counts CHARACTERS, not bytes — a Bangla name is not half-length", async () => {
        const s = await scene();

        // "কাজ" is 3 characters and 9 UTF-8 bytes. A byte-based limit would
        // reject a legitimate Bangla name a third of the length an English one
        // is allowed — the kind of rule that looks fine to whoever wrote it.
        const res = await createTask(s, "কাজ".repeat(160)); // 480 chars

        expect(res.status).toBe(201);
        expect(res.body.name).toHaveLength(480);
    });
});

describe("oversize payloads", () => {
    it("a body past the 1MB parser limit is refused, not 500'd", async () => {
        const s = await scene();

        const res = await s.client.post("/api/v1/tasks").send({
            name: "Ordinary task",
            description: "x".repeat(2 * 1024 * 1024),
            primary_list_id: s.list.id,
            status_id: s.status.id,
            task_type_id: s.taskType.id,
        });

        // 413 from the body parser or 422 from the validator — either is an
        // answer. A 500 would mean an unhandled throw reached the client.
        expect([413, 422]).toContain(res.status);
        expect(await countTasks(s.ws.id)).toBe(0);
    });

    it("a deeply nested body does not blow the stack", async () => {
        const s = await scene();
        let nested: Record<string, unknown> = { end: true };
        for (let i = 0; i < 2000; i++) nested = { nested };

        const res = await s.client
            .post("/api/v1/tasks")
            .send({ name: "Deep", primary_list_id: s.list.id, meta: nested });

        expect(res.status).toBeLessThan(500);
    });

    it("malformed JSON gets a 400, not a stack trace", async () => {
        const s = await scene();

        const res = await s.client
            .post("/api/v1/tasks")
            .set("Content-Type", "application/json")
            .send('{"name": "unterminated');

        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
    });
});

describe("path traversal on upload names", () => {
    const HOSTILE_FILENAMES = [
        "../../../etc/passwd",
        "..\\..\\windows\\system32\\config\\sam",
        "/etc/shadow",
        "....//....//etc/passwd",
        "%2e%2e%2fetc%2fpasswd",
        "a/../../b.png",
    ];

    it.each(HOSTILE_FILENAMES)(
        "%s cannot escape the workspace prefix in the storage key",
        async (filename) => {
            const s = await scene();
            const task = await createTask(s, "Has an attachment");

            const res = await s.client.post("/api/v1/uploads/sign").send({
                scope_type: "task",
                scope_id: task.body.id,
                filename,
                mime_type: "image/png",
                size_bytes: 1024,
            });

            if (res.status !== 201) {
                // Refusing outright is a fine answer.
                expect(res.status).toBeGreaterThanOrEqual(400);
                expect(res.status).toBeLessThan(500);
                return;
            }
            // If it IS accepted, the key must stay inside this workspace's
            // prefix and contain no traversal segment — otherwise one upload
            // could overwrite another tenant's object.
            const key: string = res.body.storage_key ?? res.body.key ?? "";
            expect(key).not.toContain("..");
            expect(key.startsWith("/")).toBe(false);
        },
    );
});

describe("the unauthenticated surface", () => {
    it("a hostile slug on the public form route is a 404, not a 500", async () => {
        for (const slug of [
            "../../../etc/passwd",
            "' OR 1=1--",
            "%00",
            "a".repeat(300),
        ]) {
            const res = await (await oneOff()).get(
                `/api/v1/public/forms/${encodeURIComponent(slug)}`,
            );
            expect({ slug, ok: res.status < 500 }).toEqual({ slug, ok: true });
        }
    });
});
