import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeList,
    makeSpace,
    makeStatus,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { comments, lists, spaces, tasks } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/search` (§24).
 *
 * Multi-resource typeahead (🔐 any member) across tasks, lists, spaces, users,
 * comments. Workspace-scoped; LIKE on name (task also EXACT custom_id); per-type
 * `limit` (default 20, max 50); blank `q` ⇒ empty 200; unknown `types` ignored.
 */

const SEARCH = "/api/v1/search";

interface SearchBody {
    tasks: Array<{ id: string; name: string; custom_id: string | null; assignees: string[] }>;
    lists: Array<{ id: string; name: string; space_id: string }>;
    spaces: Array<{ id: string; name: string }>;
    users: Array<{ id: string; first_name: string; last_name: string; email: string }>;
    comments: Array<{
        id: string;
        task_id: string;
        parent_comment_id: string | null;
        author_id: string;
        body: string;
        edited_at: string | null;
        created_at: string;
    }>;
    total: number;
}

let taskNo = 0;

const fixture = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const actor = await makeUser({
        workspaceId: ws.id,
        role,
        firstName: "Aragorn",
        lastName: "Actor",
    });
    const client = await makeLoggedInClient(actor);
    const space = await makeSpace({ workspaceId: ws.id, createdBy: actor.id });
    const list = await makeList({
        workspaceId: ws.id,
        spaceId: space.id,
        createdBy: actor.id,
    });
    const status = await makeStatus({ scopeId: list.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    return { ws, actor, client, space, list, status, taskType };
};

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Insert a task row directly (fast; bypasses the §10 create path). */
const seedTask = async (
    f: Fixture,
    name: string,
    customId: string | null = null,
): Promise<string> => {
    const id = fakeId("t");
    await getDb()
        .insert(tasks)
        .values({
            id,
            workspaceId: f.ws.id,
            primaryListId: f.list.id,
            taskNumber: ++taskNo,
            name,
            customId,
            statusId: f.status.id,
            taskTypeId: f.taskType.id,
            createdBy: f.actor.id,
        });
    return id;
};

/** Insert a list row directly in the fixture's space. */
const seedList = async (f: Fixture, name: string): Promise<string> => {
    const id = fakeId("l");
    await getDb()
        .insert(lists)
        .values({
            id,
            spaceId: f.space.id,
            name,
            createdBy: f.actor.id,
        });
    return id;
};

/** Insert a space row directly in the fixture's workspace. */
const seedSpace = async (f: Fixture, name: string): Promise<string> => {
    const id = fakeId("sp");
    await getDb()
        .insert(spaces)
        .values({
            id,
            workspaceId: f.ws.id,
            name,
            createdBy: f.actor.id,
            position: 0,
        });
    return id;
};

/** Insert a comment row directly on a task (no §14 factory exists). */
const seedComment = async (
    f: Fixture,
    taskId: string,
    body: string,
    deletedAt: Date | null = null,
): Promise<string> => {
    const id = fakeId("c");
    await getDb().insert(comments).values({
        id,
        taskId,
        authorId: f.actor.id,
        body,
        deletedAt,
    });
    return id;
};

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

describe("GET /api/v1/search", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("always returns all five arrays + total", async () => {
            const { client } = await fixture();
            const res = await client.get(`${SEARCH}?q=nomatch-zzz`);
            expect(res.status).toBe(200);
            const body = res.body as SearchBody;
            expect(body).toEqual({
                tasks: [],
                lists: [],
                spaces: [],
                users: [],
                comments: [],
                total: 0,
            });
        });

        it("matches a task by name and returns a full hydrated wire Task", async () => {
            const f = await fixture();
            const id = await seedTask(f, "Eid Campaign launch");

            const res = await f.client.get(`${SEARCH}?q=campaign`);

            const body = res.body as SearchBody;
            expect(body.tasks).toHaveLength(1);
            expect(body.tasks[0].id).toBe(id);
            expect(body.tasks[0].name).toBe("Eid Campaign launch");
            expect(Array.isArray(body.tasks[0].assignees)).toBe(true);
            // full WireTask shape includes snake_case relational fields
            expect(body.tasks[0]).toHaveProperty("primary_list_id", f.list.id);
            expect(body.tasks[0]).toHaveProperty("workspace_id", f.ws.id);
            expect(body.total).toBe(1);
        });

        it("matches a task by EXACT custom_id (not a substring)", async () => {
            const f = await fixture();
            await seedTask(f, "Delivery follow-up", "ORD-1042");

            const exact = await f.client.get(`${SEARCH}?q=ORD-1042`);
            expect((exact.body as SearchBody).tasks).toHaveLength(1);

            // a partial custom_id must NOT match (exact-only), and the name has no "ORD-10"
            const partial = await f.client.get(`${SEARCH}?q=ORD-10`);
            expect((partial.body as SearchBody).tasks).toHaveLength(0);
        });

        it("matches lists and spaces by name", async () => {
            const f = await fixture();
            await seedList(f, "Marketing Sprint");
            await seedSpace(f, "Marketing Ops");

            const res = await f.client.get(`${SEARCH}?q=marketing`);
            const body = res.body as SearchBody;
            expect(body.lists.map((l) => l.name)).toContain("Marketing Sprint");
            expect(body.lists[0].space_id).toBe(f.space.id);
            expect(body.spaces.map((s) => s.name)).toContain("Marketing Ops");
        });

        it("matches a user by first name, last name, or email", async () => {
            const f = await fixture();
            await makeUser({
                workspaceId: f.ws.id,
                firstName: "Zaphod",
                lastName: "Beeblebrox",
                email: "zaphod@galaxy.test",
            });

            const byFirst = await f.client.get(`${SEARCH}?q=zaphod`);
            expect((byFirst.body as SearchBody).users.some((u) => u.first_name === "Zaphod")).toBe(true);

            const byEmail = await f.client.get(`${SEARCH}?q=galaxy.test`);
            expect((byEmail.body as SearchBody).users.some((u) => u.email === "zaphod@galaxy.test")).toBe(true);
        });

        it("matches a comment by body and shapes it as the wire Comment", async () => {
            const f = await fixture();
            const taskId = await seedTask(f, "Host task");
            const commentId = await seedComment(f, taskId, "please find this needle text");

            const res = await f.client.get(`${SEARCH}?q=needle`);
            const body = res.body as SearchBody;

            expect(body.comments).toHaveLength(1);
            const c = body.comments[0];
            expect(c.id).toBe(commentId);
            expect(c.task_id).toBe(taskId);
            expect(c.author_id).toBe(f.actor.id);
            expect(c.body).toContain("needle");
            expect(Object.keys(c).sort()).toEqual([
                "author_id",
                "body",
                "created_at",
                "edited_at",
                "id",
                "parent_comment_id",
                "task_id",
            ]);
            expect(c).not.toHaveProperty("deleted_at");
            expect(c).not.toHaveProperty("internal_id");
        });

        it("matches across multiple types and sums total", async () => {
            const f = await fixture();
            await seedTask(f, "shared keyword task");
            await seedList(f, "shared keyword list");
            await seedSpace(f, "shared keyword space");

            const res = await f.client.get(`${SEARCH}?q=keyword`);
            const body = res.body as SearchBody;
            expect(body.tasks).toHaveLength(1);
            expect(body.lists).toHaveLength(1);
            expect(body.spaces).toHaveLength(1);
            expect(body.total).toBe(
                body.tasks.length +
                    body.lists.length +
                    body.spaces.length +
                    body.users.length +
                    body.comments.length,
            );
        });
    });

    // ─── b. types filter ──────────────────────────────────────────────────────
    describe("types filter", () => {
        const seedOnePerType = async (f: Fixture) => {
            await seedTask(f, "filterme task");
            await seedList(f, "filterme list");
            await seedSpace(f, "filterme space");
        };

        it("?types=task searches only tasks", async () => {
            const f = await fixture();
            await seedOnePerType(f);
            const body = (await f.client.get(`${SEARCH}?q=filterme&types=task`)).body as SearchBody;
            expect(body.tasks).toHaveLength(1);
            expect(body.lists).toHaveLength(0);
            expect(body.spaces).toHaveLength(0);
        });

        it("?types=task,space searches both", async () => {
            const f = await fixture();
            await seedOnePerType(f);
            const body = (await f.client.get(`${SEARCH}?q=filterme&types=task,space`)).body as SearchBody;
            expect(body.tasks).toHaveLength(1);
            expect(body.spaces).toHaveLength(1);
            expect(body.lists).toHaveLength(0);
        });

        it("empty ?types= searches all", async () => {
            const f = await fixture();
            await seedOnePerType(f);
            const body = (await f.client.get(`${SEARCH}?q=filterme&types=`)).body as SearchBody;
            expect(body.tasks.length + body.lists.length + body.spaces.length).toBe(3);
        });

        it("ignores the stale 'note' type (no 422, returns nothing for note)", async () => {
            const f = await fixture();
            await seedOnePerType(f);
            const res = await f.client.get(`${SEARCH}?q=filterme&types=note`);
            expect(res.status).toBe(200);
            const body = res.body as SearchBody;
            expect(body.total).toBe(0);
            expect(body).not.toHaveProperty("notes");
        });

        it("?types=task,note searches tasks and silently drops note", async () => {
            const f = await fixture();
            await seedOnePerType(f);
            const res = await f.client.get(`${SEARCH}?q=filterme&types=task,note`);
            expect(res.status).toBe(200);
            const body = res.body as SearchBody;
            expect(body.tasks).toHaveLength(1);
            expect(body.lists).toHaveLength(0);
        });
    });

    // ─── c. limit ─────────────────────────────────────────────────────────────
    describe("limit", () => {
        it("defaults to 20 results per type", async () => {
            const f = await fixture();
            for (let i = 0; i < 25; i++) await seedTask(f, `limitword task ${i}`);
            const body = (await f.client.get(`${SEARCH}?q=limitword`)).body as SearchBody;
            expect(body.tasks).toHaveLength(20);
        });

        it("honours an explicit ?limit=5", async () => {
            const f = await fixture();
            for (let i = 0; i < 10; i++) await seedTask(f, `lim5 task ${i}`);
            const body = (await f.client.get(`${SEARCH}?q=lim5&limit=5`)).body as SearchBody;
            expect(body.tasks).toHaveLength(5);
        });

        it("clamps ?limit above 50 down to 50", async () => {
            const f = await fixture();
            for (let i = 0; i < 55; i++) await seedTask(f, `clampword ${i}`);
            const body = (await f.client.get(`${SEARCH}?q=clampword&limit=100`)).body as SearchBody;
            expect(body.tasks).toHaveLength(50);
        });

        it("applies the limit PER TYPE (not as a global cap)", async () => {
            const f = await fixture();
            for (let i = 0; i < 4; i++) await seedTask(f, `perty task ${i}`);
            for (let i = 0; i < 4; i++) await seedList(f, `perty list ${i}`);
            const body = (await f.client.get(`${SEARCH}?q=perty&limit=3`)).body as SearchBody;
            expect(body.tasks).toHaveLength(3);
            expect(body.lists).toHaveLength(3);
            expect(body.total).toBe(6);
        });

        it("422 for ?limit=0 and ?limit=abc", async () => {
            const f = await fixture();
            const zero = await f.client.get(`${SEARCH}?q=x&limit=0`);
            expect(zero.status).toBe(422);
            expect(zero.body.error.code).toBe("validation.failed");
            const nan = await f.client.get(`${SEARCH}?q=x&limit=abc`);
            expect(nan.status).toBe(422);
        });
    });

    // ─── d. Empty / missing query ─────────────────────────────────────────────
    describe("Empty query", () => {
        it("200 empty when q is missing entirely", async () => {
            const f = await fixture();
            await seedTask(f, "anything");
            const res = await f.client.get(SEARCH);
            expect(res.status).toBe(200);
            expect((res.body as SearchBody).total).toBe(0);
        });

        it("200 empty for a blank / whitespace-only q", async () => {
            const f = await fixture();
            await seedTask(f, "anything");
            const blank = await f.client.get(`${SEARCH}?q=`);
            expect(blank.status).toBe(200);
            expect((blank.body as SearchBody).total).toBe(0);
            const ws = await f.client.get(`${SEARCH}?q=${encodeURIComponent("   ")}`);
            expect(ws.status).toBe(200);
            expect((ws.body as SearchBody).total).toBe(0);
        });
    });

    // ─── e. Workspace isolation ───────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("never returns tasks/lists/spaces/users/comments from another workspace", async () => {
            const f = await fixture();
            const other = await fixture(); // a separate workspace + content
            await seedTask(other, "secret isolatedword task");
            await seedList(other, "secret isolatedword list");
            await seedSpace(other, "secret isolatedword space");
            const otherTask = await seedTask(other, "host");
            await seedComment(other, otherTask, "isolatedword comment");
            await makeUser({
                workspaceId: other.ws.id,
                firstName: "Isolatedword",
                lastName: "Person",
            });

            const body = (await f.client.get(`${SEARCH}?q=isolatedword`)).body as SearchBody;
            expect(body.total).toBe(0);
        });

        it("scopes comments via the task→workspace join", async () => {
            const f = await fixture();
            const mine = await seedTask(f, "my task");
            await seedComment(f, mine, "joinscope mine");
            const other = await fixture();
            const theirs = await seedTask(other, "their task");
            await seedComment(other, theirs, "joinscope theirs");

            const body = (await f.client.get(`${SEARCH}?q=joinscope`)).body as SearchBody;
            expect(body.comments).toHaveLength(1);
            expect(body.comments[0].body).toContain("mine");
        });
    });

    // ─── f. Comments specifics ────────────────────────────────────────────────
    describe("Comments", () => {
        it("excludes soft-deleted (tombstoned) comments even if the body matches", async () => {
            const f = await fixture();
            const taskId = await seedTask(f, "host");
            await seedComment(f, taskId, "tombstoneword live");
            await seedComment(f, taskId, "tombstoneword deleted", new Date());

            const body = (await f.client.get(`${SEARCH}?q=tombstoneword`)).body as SearchBody;
            expect(body.comments).toHaveLength(1);
            expect(body.comments[0].body).toContain("live");
        });

        it("excludes comments whose parent task is archived (consistent with task search)", async () => {
            const f = await fixture();
            const taskId = await seedTask(f, "soon-archived host");
            await seedComment(f, taskId, "archivedparent commentword");
            await getDb()
                .update(tasks)
                .set({ archivedAt: new Date() })
                .where(eq(tasks.id, taskId));

            const body = (await f.client.get(`${SEARCH}?q=commentword`)).body as SearchBody;
            expect(body.comments).toHaveLength(0);
        });
    });

    // ─── g. Wildcard escaping ─────────────────────────────────────────────────
    describe("Wildcard escaping", () => {
        it("treats % in q as a literal", async () => {
            const f = await fixture();
            await seedTask(f, "100% bonus task");
            await seedTask(f, "100 plain task");

            const body = (await f.client.get(`${SEARCH}?q=${encodeURIComponent("100%")}`)).body as SearchBody;
            const names = body.tasks.map((t) => t.name);
            expect(names).toContain("100% bonus task");
            expect(names).not.toContain("100 plain task");
        });
    });

    // ─── h. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.get(`${SEARCH}?q=x`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const u = await makeUser();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(`${SEARCH}?q=x`)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── i. Authorization (🔐 any member, incl guest) ─────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin", "member", "guest"] as Role[]) {
            it(`allows a ${role} to search (200)`, async () => {
                const f = await fixture(role);
                await seedTask(f, "roleword task");
                const res = await f.client.get(`${SEARCH}?q=roleword`);
                expect(res.status).toBe(200);
                expect((res.body as SearchBody).tasks).toHaveLength(1);
            });
        }
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const f = await fixture();
            const res = await f.client.get(`${SEARCH}?q=x`);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("renders the spec error envelope with matching request_id on 401", async () => {
            const http = await oneOff();
            const res = await http.get(`${SEARCH}?q=x`);
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });
    });
});
