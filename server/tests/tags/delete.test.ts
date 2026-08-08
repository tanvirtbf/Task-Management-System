import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTag,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tags, taskTags, tasks, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `DELETE /api/v1/tags/:id` (§9 #4).
 *
 * Runs under jest.tags.config.js (private DB). The tags suite does NOT truncate
 * tasks/task_tags/workspace_activity, so every assertion is scoped by a specific
 * id (tag/task) or workspace_id. 👑 owner/admin; hard-deletes the tag and — via
 * `fk_task_tags_tag ON DELETE CASCADE` — removes it from every task that had it;
 * writes one `workspace_activity` 'deleted' row; returns 204. A missing or
 * cross-workspace id is `404 tag.not_found`.
 */

jest.setTimeout(30000);

const url = (id: string): string => `/api/v1/tags/${id}`;

const tagRow = async (id: string) => {
    const db = getDb();
    const [row] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    return row ?? null;
};

const taskExists = async (id: string): Promise<boolean> => {
    const db = getDb();
    return (
        (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)))
            .length > 0
    );
};

const linksForTag = async (tagId: string) => {
    const db = getDb();
    return db
        .select({ taskId: taskTags.taskId })
        .from(taskTags)
        .where(eq(taskTags.tagId, tagId));
};

const activityRows = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

/** Link an existing task to an existing tag (no factory helper exists). */
const linkTaskTag = async (taskId: string, tagId: string) => {
    const db = getDb();
    await db.insert(taskTags).values({ taskId, tagId });
};

/** Detach again — F22 made deleting an IN-USE tag a 409, so the delete specs
 *  drop the links first when the delete itself is what they exercise. */
const unlinkTaskTag = async (taskId: string, tagId: string) => {
    const db = getDb();
    await db
        .delete(taskTags)
        .where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)));
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

/** An owner (default) + a tag in their workspace + a logged-in client. */
const setup = async (opts: { role?: Role; name?: string } = {}) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const tag = await makeTag({
        workspaceId: u.workspaceId,
        name: opts.name ?? "Doomed",
        color: "#abcdef",
    });
    const client = await makeLoggedInClient(u);
    return { u, tag, client };
};

// ════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/v1/tags/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("deletes a tag and returns 204 with an empty body", async () => {
            const { tag, client } = await setup();

            const res = await client.delete(url(tag.id));

            expect(res.status).toBe(204);
            expect(res.text).toBe("");
            expect(await tagRow(tag.id)).toBeNull();
        });

        it("makes a follow-up GET /tags exclude the deleted tag", async () => {
            const { tag, client } = await setup();

            await client.delete(url(tag.id));
            const list = await client.get("/api/v1/tags");

            expect(
                (list.body.data as Array<{ id: string }>).map((t) => t.id),
            ).not.toContain(tag.id);
        });
    });

    // ─── Side effects ───────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row (tag/deleted) with context", async () => {
            const { u, tag, client } = await setup({ name: "Audited" });

            await client.delete(url(tag.id));
            const rows = await activityRows(u.workspaceId);

            expect(rows).toHaveLength(1);
            expect(rows[0].entityType).toBe("tag");
            expect(rows[0].entityId).toBe(tag.id);
            expect(rows[0].action).toBe("deleted");
            expect(rows[0].actorId).toBe(u.id);
            expect(rows[0].context).toMatchObject({ name: "Audited", color: "#abcdef" });
        });
    });

    // ─── f. FK cascade to task_tags (the §9 headline behavior) ──────────────
    describe("Cascade to task_tags", () => {
        it("refuses to delete an IN-USE tag (F22/ISS-011 — tag.in_use)", async () => {
            // Pre-F22 this spec asserted the bug as the headline behaviour:
            // 204 + the FK silently stripping the tag from its tasks. §32 has
            // always promised 409 tag.in_use; now it is real.
            const { u, tag, client } = await setup();
            const task = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
            await linkTaskTag(task.id, tag.id);
            expect(await linksForTag(tag.id)).toHaveLength(1);

            const res = await client.delete(url(tag.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("tag.in_use");
            expect(await linksForTag(tag.id)).toHaveLength(1); // link intact
            expect(await taskExists(task.id)).toBe(true);
        });

        it("deletes cleanly once every task has dropped it (the cascade path is unreachable while in use)", async () => {
            const { u, tag, client } = await setup();
            const t1 = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
            const t2 = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
            await linkTaskTag(t1.id, tag.id);
            await linkTaskTag(t2.id, tag.id);

            const blocked = await client.delete(url(tag.id));
            expect(blocked.status).toBe(409); // F22: in use on two tasks

            await unlinkTaskTag(t1.id, tag.id);
            await unlinkTaskTag(t2.id, tag.id);
            const res = await client.delete(url(tag.id));

            expect(res.status).toBe(204);
            expect(await linksForTag(tag.id)).toHaveLength(0);
            expect(await taskExists(t1.id)).toBe(true);
            expect(await taskExists(t2.id)).toBe(true);
        });

        it("leaves a different tag's links on the same task intact", async () => {
            const { u, tag, client } = await setup();
            const keep = await makeTag({ workspaceId: u.workspaceId, name: "Keeper" });
            const task = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
            await linkTaskTag(task.id, tag.id);
            await linkTaskTag(task.id, keep.id);

            await unlinkTaskTag(task.id, tag.id); // F22: an in-use tag is a 409
            await client.delete(url(tag.id));

            expect(await linksForTag(tag.id)).toHaveLength(0);
            expect(await linksForTag(keep.id)).toHaveLength(1); // untouched
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an id over 64 chars", async () => {
            const { client } = await setup();

            const res = await client.delete(url("t".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { tag } = await setup();
            const http = await oneOff();

            const res = await http.delete(url(tag.id));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, tag } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .delete(url(tag.id))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 owner/admin) ──────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to delete (204)`, async () => {
                const { tag, client } = await setup({ role });

                const res = await client.delete(url(tag.id));

                expect(res.status).toBe(204);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} (403) and keeps the tag`, async () => {
                const { u, tag, client } = await setup({ role });

                const res = await client.delete(url(tag.id));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await tagRow(tag.id)).not.toBeNull();
                expect(await activityRows(u.workspaceId)).toHaveLength(0);
            });
        }

        it("checks the role BEFORE resource existence (403, not 404, for a member on a missing id)", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(url("tag-nope"));

            expect(res.status).toBe(403);
        });

        it("checks the role BEFORE id validation (403, not 422, for a member with a 65-char id)", async () => {
            const { client } = await setup({ role: "member" });

            const res = await client.delete(url("t".repeat(65)));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });
    });

    // ─── e. Not found / tenant isolation ────────────────────────────────────
    describe("Not found & isolation", () => {
        it("returns 404 tag.not_found for a non-existent id", async () => {
            const { client } = await setup();

            const res = await client.delete(url("tag-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("tag.not_found");
        });

        it("returns 404 for a tag in another workspace [IDOR] and keeps it", async () => {
            const userA = await makeUser({ role: "owner" });
            const wsB = await makeWorkspace();
            const tagB = await makeTag({ workspaceId: wsB.id, name: "B-tag" });
            const client = await makeLoggedInClient(userA);

            const res = await client.delete(url(tagB.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("tag.not_found");
            expect(await tagRow(tagB.id)).not.toBeNull();
        });
    });

    // ─── h. Idempotency / concurrency ───────────────────────────────────────
    describe("Idempotency & concurrency", () => {
        it("deleting twice returns 204 then 404", async () => {
            const { tag, client } = await setup();

            const first = await client.delete(url(tag.id));
            const second = await client.delete(url(tag.id));

            expect(first.status).toBe(204);
            expect(second.status).toBe(404);
            expect(second.body.error.code).toBe("tag.not_found");
        });

        it("5 parallel deletes — exactly one 204, the rest 404, one activity row", async () => {
            const { u, tag, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 5 }, () => client.delete(url(tag.id))),
            );

            expect(results.filter((r) => r.status === 204)).toHaveLength(1);
            expect(results.filter((r) => r.status === 404)).toHaveLength(4);
            expect(await tagRow(tag.id)).toBeNull();
            expect(await activityRows(u.workspaceId)).toHaveLength(1);
        });
    });

    // ─── Cross-cutting & exploratory ────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("sends an X-Request-Id header on the 204", async () => {
            const { tag, client } = await setup();

            const res = await client.delete(url(tag.id));

            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 404 route.not_found for GET /tags/:id (no single-tag read endpoint)", async () => {
            const { tag, client } = await setup();

            const res = await client.get(url(tag.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("treats an injection-shaped id as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client.delete(
                url(encodeURIComponent("tag-1' OR '1'='1")),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("tag.not_found");
        });
    });
});
