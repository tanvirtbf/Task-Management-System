import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks, templates } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";
import { TEMPLATES, seedTemplate, setup, signAccess } from "./helpers";

/**
 * Tests for `DELETE /api/v1/templates/:id` (§23 #5).
 *
 * 👑 owner/admin hard delete. Returns 204. A missing or cross-workspace id is
 * 404 `template.not_found`. Tasks already spawned from a template are
 * unaffected (no FK from `tasks` to `templates`).
 */

const exists = async (id: string): Promise<boolean> =>
    (
        await getDb()
            .select({ id: templates.id })
            .from(templates)
            .where(eq(templates.id, id))
    ).length > 0;

describe("DELETE /api/v1/templates/:id", () => {
    describe("Happy path", () => {
        it("deletes the template and returns 204 with no body", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });

            const res = await client.delete(`${TEMPLATES}/${t.id}`);

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(await exists(t.id)).toBe(false);
        });

        it("leaves existing tasks untouched (no cascade)", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const task = await makeTask({
                workspaceId: ws.id,
                createdBy: actor.id,
            });

            await client.delete(`${TEMPLATES}/${t.id}`);

            const taskRows = await getDb()
                .select({ id: tasks.id })
                .from(tasks)
                .where(eq(tasks.id, task.id));
            expect(taskRows).toHaveLength(1);
        });
    });

    describe("Not found / idempotency", () => {
        it("404 template.not_found for an unknown id", async () => {
            const { client } = await setup();
            const res = await client.delete(`${TEMPLATES}/tpl-missing`);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("template.not_found");
        });

        it("a repeated delete returns 404 the second time", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });

            const first = await client.delete(`${TEMPLATES}/${t.id}`);
            const second = await client.delete(`${TEMPLATES}/${t.id}`);

            expect(first.status).toBe(204);
            expect(second.status).toBe(404);
            expect(second.body.error.code).toBe("template.not_found");
        });
    });

    describe("Authentication & authorization", () => {
        it("401 auth.missing_token without a token", async () => {
            const { ws, actor } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const http = await oneOff();
            const res = await http.delete(`${TEMPLATES}/${t.id}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const u = await makeUser({ role: "admin" });
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .delete(`${TEMPLATES}/tpl-x`)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
        });

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} with 403 and keeps the row`, async () => {
                const ws = await makeWorkspace();
                const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
                const t = await seedTemplate({
                    workspaceId: ws.id,
                    createdBy: owner.id,
                });
                const member = await makeUser({ workspaceId: ws.id, role });
                const client = await makeLoggedInClient(member);

                const res = await client.delete(`${TEMPLATES}/${t.id}`);

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await exists(t.id)).toBe(true);
            });
        }
    });

    describe("Workspace isolation", () => {
        it("404 when deleting a template in another workspace, and the row survives", async () => {
            const other = await makeWorkspace();
            const otherUser = await makeUser({ workspaceId: other.id });
            const foreign = await seedTemplate({
                workspaceId: other.id,
                createdBy: otherUser.id,
            });
            const { client } = await setup();

            const res = await client.delete(`${TEMPLATES}/${foreign.id}`);

            expect(res.status).toBe(404);
            expect(await exists(foreign.id)).toBe(true);
        });
    });
});
