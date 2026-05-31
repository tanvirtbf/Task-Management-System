import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeList,
    makeStatus,
    makeTag,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    checklistItems,
    checklists,
    lists,
    taskActivity,
    taskTags,
    tasks,
    templates,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import {
    TEMPLATES,
    seedTemplate,
    signAccess,
    validStructure,
} from "./helpers";
import type { TemplateStructure } from "../../src/types/templates";

/**
 * Tests for `POST /api/v1/templates/:id/apply` (§23 #6).
 *
 * 🔐 any member. In one transaction it spawns a task (taskType/priority/tags
 * from the template's structure, default status = list's lowest position),
 * inserts the checklist + items, bumps `usage_count`, and logs a
 * `created_from_template` activity row. Per the product decision, per-item due
 * dates are NOT materialised (no `checklist_items.due_date` column).
 */

const applyUrl = (id: string) => `${TEMPLATES}/${id}/apply`;

/** Workspace + member actor + a list with a status + a task type, all wired. */
const applySetup = async () => {
    const ws = await makeWorkspace();
    const actor = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(actor);
    const list = await makeList({ workspaceId: ws.id, createdBy: actor.id });
    const status = await makeStatus({
        scopeId: list.id,
        statusGroup: "not_started",
    });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    return { ws, actor, client, list, status, taskType };
};

interface ApplyBody {
    id: string;
    task_number: number;
    name: string;
    primary_list_id: string;
    task_type_id: string;
    priority: number;
    tags: string[];
    subtasks_count: number;
    checklists: Array<{
        id: string;
        name: string;
        items: Array<{
            id: string;
            checklist_id: string;
            parent_item_id: string | null;
            text: string;
            is_completed: boolean;
            completed_at: string | null;
            completed_by: string | null;
            assignee_id: string | null;
            position: number;
        }>;
    }>;
    created_at: string;
}

describe("POST /api/v1/templates/:id/apply", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("spawns a task + checklist and returns the 201 summary", async () => {
            const { ws, actor, client, list, status, taskType } =
                await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Eid Campaign",
                structure: validStructure({
                    taskTypeId: taskType.id,
                    priority: 2,
                    checklistName: "Eid 12-step",
                }),
            });

            const res = await client.post(applyUrl(tpl.id)).send({
                list_id: list.id,
            });

            expect(res.status).toBe(201);
            const body = res.body as ApplyBody;
            expect(body.id).toMatch(/^t-/);
            expect(typeof body.task_number).toBe("number");
            expect(body.name).toBe("Eid Campaign"); // defaults to template name
            expect(body.primary_list_id).toBe(list.id);
            expect(body.task_type_id).toBe(taskType.id);
            expect(body.priority).toBe(2);
            expect(body.subtasks_count).toBe(0);
            expect(body.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
            );
            expect(body.checklists).toHaveLength(1);
            expect(body.checklists[0].name).toBe("Eid 12-step");
            expect(body.checklists[0].items).toHaveLength(2);
            expect(body.checklists[0].items[0]).toEqual({
                id: expect.stringMatching(/^ci-/),
                checklist_id: body.checklists[0].id,
                parent_item_id: null,
                text: "First step",
                is_completed: false,
                completed_at: null,
                completed_by: null,
                assignee_id: null,
                position: 0,
            });

            // Task landed in the right list, workspace, status, type.
            const db = getDb();
            const [task] = await db
                .select()
                .from(tasks)
                .where(eq(tasks.id, body.id));
            expect(task.workspaceId).toBe(ws.id);
            expect(task.primaryListId).toBe(list.id);
            expect(task.statusId).toBe(status.id);
            expect(task.taskTypeId).toBe(taskType.id);
            expect(task.priority).toBe(2);
            expect(task.createdBy).toBe(actor.id);
            expect(task.parentTaskId).toBeNull();
        });

        it("persists the checklist + items and bumps usage_count", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
                usageCount: 3,
            });

            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });
            const body = res.body as ApplyBody;

            const db = getDb();
            const [ck] = await db
                .select()
                .from(checklists)
                .where(eq(checklists.taskId, body.id));
            expect(ck).toBeDefined();
            const ckItems = await db
                .select()
                .from(checklistItems)
                .where(eq(checklistItems.checklistId, ck.id));
            expect(ckItems).toHaveLength(2);

            const [tplRow] = await db
                .select()
                .from(templates)
                .where(eq(templates.id, tpl.id));
            expect(tplRow.usageCount).toBe(4); // 3 → 4
        });

        it("logs a created_from_template activity row", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });

            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });
            const body = res.body as ApplyBody;

            const db = getDb();
            const acts = await db
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, body.id));
            const created = acts.find(
                (a) => a.action === "created_from_template",
            );
            expect(created).toBeDefined();
            expect(created?.actorId).toBe(actor.id);
            expect(
                (created?.context as { templateId?: string })?.templateId,
            ).toBe(tpl.id);
        });

        it("attaches the template's tags to the spawned task", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tag = await makeTag({ workspaceId: ws.id });
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({
                    taskTypeId: taskType.id,
                    tags: [tag.id],
                }),
            });

            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });
            const body = res.body as ApplyBody;
            expect(body.tags).toEqual([tag.id]);

            const db = getDb();
            const rows = await db
                .select()
                .from(taskTags)
                .where(eq(taskTags.taskId, body.id));
            expect(rows.map((r) => r.tagId)).toEqual([tag.id]);
        });

        it("uses task_name when supplied", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Template Name",
                structure: validStructure({ taskTypeId: taskType.id }),
            });

            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id, task_name: "Eid 2026 Run" });

            expect((res.body as ApplyBody).name).toBe("Eid 2026 Run");
        });

        it("falls back to the list's default task type when the structure has none", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const db = getDb();
            await db
                .update(lists)
                .set({ defaultTaskTypeId: taskType.id })
                .where(eq(lists.id, list.id));
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure(), // no taskTypeId
            });

            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });

            expect(res.status).toBe(201);
            expect((res.body as ApplyBody).task_type_id).toBe(taskType.id);
        });

        it("increments usage_count by exactly one per apply (two applies → two tasks)", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });

            await client.post(applyUrl(tpl.id)).send({ list_id: list.id });
            await client.post(applyUrl(tpl.id)).send({ list_id: list.id });

            const db = getDb();
            const [tplRow] = await db
                .select()
                .from(templates)
                .where(eq(templates.id, tpl.id));
            expect(tplRow.usageCount).toBe(2);
            const spawned = await db
                .select({ id: tasks.id })
                .from(tasks)
                .where(eq(tasks.primaryListId, list.id));
            expect(spawned).toHaveLength(2);
        });
    });

    // ─── Business errors ──────────────────────────────────────────────────────
    describe("Business errors", () => {
        it("404 template.not_found for an unknown template id", async () => {
            const { client, list } = await applySetup();
            const res = await client
                .post(applyUrl("tpl-missing"))
                .send({ list_id: list.id });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("template.not_found");
        });

        it("404 list.not_found for an unknown list id", async () => {
            const { ws, actor, client, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });
            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: "l-missing" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("409 list.archived for an archived target list", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const db = getDb();
            await db
                .update(lists)
                .set({ archivedAt: new Date() })
                .where(eq(lists.id, list.id));
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });

            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("list.archived");
        });

        it("422 template.empty_structure when the template has no checklist items", async () => {
            const { ws, actor, client, list } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: { checklistItems: [] } as TemplateStructure,
            });
            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.empty_structure");
        });

        it("422 template.invalid_task_type when the structure's task type was since deleted", async () => {
            const { ws, actor, client, list } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: "tt-deleted" }),
            });
            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.invalid_task_type");
        });

        it("422 template.invalid_tag when a structure tag was since deleted", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({
                    taskTypeId: taskType.id,
                    tags: ["tag-deleted"],
                }),
            });
            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.invalid_tag");
        });

        it("writes no task when a business rule rejects the apply", async () => {
            const { ws, actor, client, list } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: "tt-deleted" }),
            });
            await client.post(applyUrl(tpl.id)).send({ list_id: list.id });
            const db = getDb();
            const rows = await db
                .select({ id: tasks.id })
                .from(tasks)
                .where(eq(tasks.primaryListId, list.id));
            expect(rows).toHaveLength(0);
        });
    });

    // ─── Validation ─────────────────────────────────────────────────────────--
    describe("Validation", () => {
        it("422 validation.failed when list_id is missing", async () => {
            const { ws, actor, client, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });
            const res = await client.post(applyUrl(tpl.id)).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 validation.failed for a malformed anchor_date", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });
            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id, anchor_date: "not-a-date" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("accepts a valid ISO anchor_date (even though it is not materialised)", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });
            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id, anchor_date: "2026-05-15" });
            expect(res.status).toBe(201);
        });
    });

    // ─── Authentication / Authorization (🔐 any member) ───────────────────────
    describe("Authentication & authorization", () => {
        it("401 auth.missing_token without a token", async () => {
            const { ws, actor, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });
            const http = await oneOff();
            const res = await http
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });
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
                .post(applyUrl("tpl-x"))
                .set("Authorization", `Bearer ${token}`)
                .send({ list_id: "l-x" });
            expect(res.status).toBe(401);
        });

        it("allows a guest (🔐 any authenticated member) to apply (201)", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id, role: "guest" });
            const client = await makeLoggedInClient(actor);
            const list = await makeList({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            await makeStatus({ scopeId: list.id });
            const taskType = await makeTaskType({ workspaceId: ws.id });
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });

            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });

            expect(res.status).toBe(201);
        });
    });

    // ─── Workspace isolation ──────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("404 template.not_found when applying a template from another workspace", async () => {
            const { client, list } = await applySetup();
            const other = await makeWorkspace();
            const otherUser = await makeUser({ workspaceId: other.id });
            const foreign = await seedTemplate({
                workspaceId: other.id,
                createdBy: otherUser.id,
                structure: validStructure(),
            });

            const res = await client
                .post(applyUrl(foreign.id))
                .send({ list_id: list.id });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("template.not_found");
        });

        it("404 list.not_found when the list belongs to another workspace", async () => {
            const { ws, actor, client, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });
            const other = await makeWorkspace();
            const otherUser = await makeUser({ workspaceId: other.id });
            const foreignList = await makeList({
                workspaceId: other.id,
                createdBy: otherUser.id,
            });

            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: foreignList.id });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { ws, actor, client, list, taskType } = await applySetup();
            const tpl = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ taskTypeId: taskType.id }),
            });
            const res = await client
                .post(applyUrl(tpl.id))
                .send({ list_id: list.id });
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
