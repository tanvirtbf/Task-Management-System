import { eq } from "drizzle-orm";
import {
    makeList,
    makeLoggedInClient,
    makeSpace,
    makeStatus,
    makeTag,
    makeTask,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    customFields,
    taskAssignees,
    taskDeleteRequests,
    taskTags,
    taskWatchers,
    tasks,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";

/**
 * ONE SERIALIZER, MANY SURFACES — does the same task really look the same
 * everywhere?
 *
 * `toWireTask` is used by seven services, and that is a deliberate design
 * choice: the `assigned_by` fallback, the date formatting and the hydration
 * shape live at one boundary rather than in seven places that would each have
 * to remember them. The Assigned By work leaned on it explicitly.
 *
 * But "one serializer" is only half the story. The serializer takes a
 * `TaskHydration` alongside the row, and each surface builds that hydration
 * itself — so two surfaces can call the same function and still disagree, if
 * one of them looks up less. Nothing tested that, and it is invisible from any
 * single endpoint's tests: each one asserts its own payload is right, and they
 * can all be right about different things.
 *
 * So: populate one task as fully as the API allows, read it back through every
 * P4 surface that returns a whole task, and compare the payloads key by key.
 * Differences are not automatically wrong — but each one has to be named here,
 * which is what turns a silent divergence into a decision.
 */

jest.setTimeout(60_000);

interface WireTaskish {
    id: string;
    [key: string]: unknown;
}

const db = () => getDb();

/** Distinctive enough that the search probe below finds exactly this task. */
const TASK_NAME = "Parity probe subject";

/** A task with every hydrated collection non-empty and a pending delete request. */
const seedFullTask = async () => {
    const ws = await makeWorkspace();
    const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
    const client = await makeLoggedInClient(owner);
    const space = await makeSpace({ workspaceId: ws.id, createdBy: owner.id });
    const list = await makeList({
        workspaceId: ws.id,
        spaceId: space.id,
        createdBy: owner.id,
    });
    const status = await makeStatus({
        scopeId: list.id,
        statusGroup: "not_started",
    });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    const tag = await makeTag({ workspaceId: ws.id });
    const task = await makeTask({
        workspaceId: ws.id,
        createdBy: owner.id,
        listId: list.id,
        statusId: status.id,
        taskTypeId: taskType.id,
        name: TASK_NAME,
    });

    // The hydrated collections — the part each surface has to look up itself.
    await db().insert(taskAssignees).values({
        taskId: task.id,
        userId: owner.id,
        assignedBy: owner.id,
    });
    await db()
        .insert(taskWatchers)
        .values({ taskId: task.id, userId: owner.id });
    await db().insert(taskTags).values({ taskId: task.id, tagId: tag.id });

    const fieldId = fakeId("cf");
    await db().insert(customFields).values({
        id: fieldId,
        workspaceId: ws.id,
        name: "Tracking ID",
        type: "text",
        scopeType: "workspace",
        scopeId: null,
        createdBy: owner.id,
    });
    // The envelope is the TYPE's own shape (`{text}` for a text field), not a
    // generic `{value}`. Asserted rather than assumed: a fixture that fails
    // quietly leaves every assertion below comparing empty against empty and
    // passing for the wrong reason — which is exactly what happened the first
    // time this ran.
    const setValue = await client
        .put(`/api/v1/tasks/${task.id}/custom-fields/${fieldId}`)
        .send({ text: "TRK-1" });
    expect(setValue.status).toBe(200);

    // A pending delete request: the one hydration field the serializer
    // documents as surface-dependent.
    await db()
        .insert(taskDeleteRequests)
        .values({
            id: fakeId("tdr"),
            workspaceId: ws.id,
            spaceId: space.id,
            taskId: task.id,
            taskName: "Full task",
            requestedBy: owner.id,
            reason: "parity probe",
            status: "pending",
            createdAt: new Date(),
            updatedAt: new Date(),
        });

    return { ws, owner, client, space, list, status, taskType, tag, task };
};

describe("Task serializer parity across surfaces", () => {
    it("returns the same task, key for key, from detail / list / my-work", async () => {
        const ctx = await seedFullTask();

        const detail = (
            await ctx.client.get(`/api/v1/tasks/${ctx.task.id}`)
        ).body as WireTaskish;

        const listBody = (
            await ctx.client.get(`/api/v1/lists/${ctx.list.id}/tasks`)
        ).body as { data: WireTaskish[] };
        const fromList = listBody.data.find((t) => t.id === ctx.task.id);

        const myWorkBody = (await ctx.client.get("/api/v1/tasks/my-work"))
            .body as Record<string, WireTaskish[]>;
        const fromMyWork = Object.values(myWorkBody)
            .flat()
            .find((t) => t?.id === ctx.task.id);

        // Search belongs to P6's endpoint list but runs the same serializer,
        // and the plan asks for "list vs detail vs search" parity by name.
        const searchBody = (
            await ctx.client.get(
                `/api/v1/search?q=${encodeURIComponent(TASK_NAME)}&types=task`,
            )
        ).body as { tasks: WireTaskish[] };
        const fromSearch = searchBody.tasks.find((t) => t.id === ctx.task.id);

        expect(fromList).toBeDefined();
        expect(fromMyWork).toBeDefined();
        expect(fromSearch).toBeDefined();

        // Every surface must return the same KEY SET. A missing key is the
        // failure this test exists for: a client that reads `assigned_by` in
        // the drawer and finds it absent in the list has to special-case one
        // surface, and usually discovers that in production.
        const keys = (o: WireTaskish) => Object.keys(o).sort();
        expect(keys(fromList!)).toEqual(keys(detail));
        expect(keys(fromMyWork!)).toEqual(keys(detail));
        expect(keys(fromSearch!)).toEqual(keys(detail));

        /**
         * And the same VALUES — with one field excluded, and the exclusion is
         * itself the finding.
         *
         * `delete_request_pending` comes from the hydration, not the row, so
         * every surface has to look it up. The serializer calls `false` the
         * "honest default" for surfaces that do not, which holds only as long
         * as no such surface renders the badge — and two of them did.
         * P4 fixed My Work (D4.3). Search still reports `false`; that endpoint
         * is P6's, and whether search results should carry the badge at all is
         * P6's decision to take.
         *
         * Anything ELSE differing is a plain failure.
         */
        const SURFACE_DEPENDENT = new Set(["delete_request_pending"]);
        const compare = (surface: WireTaskish, label: string) => {
            const differing = Object.keys(detail).filter(
                (k) =>
                    !SURFACE_DEPENDENT.has(k) &&
                    JSON.stringify(surface[k]) !== JSON.stringify(detail[k]),
            );
            expect({ label, differing }).toEqual({ label, differing: [] });
        };
        compare(fromList!, "list");
        compare(fromMyWork!, "my-work");
        compare(fromSearch!, "search");
    });

    it("records WHICH surfaces report a pending delete request", async () => {
        // The exception above, pinned as a fact rather than left implicit. If a
        // surface starts or stops hydrating it, this test says so — and the
        // question "should search show the badge?" becomes a decision someone
        // takes on purpose.
        //
        // My Work was `false` here when this test was first written, and that
        // was a real defect rather than a documented default: `TaskRow` renders
        // the badge on the Home page exactly as `ListViewRow` does in the List
        // view, so the same task warned you it was about to be permanently
        // deleted in one place and said nothing in the other. Fixed in P4
        // (D4.3). Search still reports `false` — that endpoint belongs to P6,
        // which owns the decision about whether search results should carry the
        // badge at all.
        const ctx = await seedFullTask();

        const detail = (await ctx.client.get(`/api/v1/tasks/${ctx.task.id}`))
            .body as WireTaskish;
        const listBody = (
            await ctx.client.get(`/api/v1/lists/${ctx.list.id}/tasks`)
        ).body as { data: WireTaskish[] };
        const myWork = (await ctx.client.get("/api/v1/tasks/my-work"))
            .body as Record<string, WireTaskish[]>;
        const searchBody = (
            await ctx.client.get(
                `/api/v1/search?q=${encodeURIComponent(TASK_NAME)}&types=task`,
            )
        ).body as { tasks: WireTaskish[] };

        expect({
            detail: detail.delete_request_pending,
            list: listBody.data.find((t) => t.id === ctx.task.id)!
                .delete_request_pending,
            myWork: Object.values(myWork)
                .flat()
                .find((t) => t?.id === ctx.task.id)!.delete_request_pending,
            search: searchBody.tasks.find((t) => t.id === ctx.task.id)!
                .delete_request_pending,
        }).toEqual({
            detail: true,
            list: true,
            myWork: true,
            search: false,
        });
    });

    it("hydrates the collections on every surface, not just the drawer", async () => {
        // `assignees`, `watchers`, `tags` and `custom_field_values` are the
        // four the serializer cannot derive from the row — each surface has to
        // fetch them. A surface that skips one returns an empty array, which
        // reads as "this task has no assignees" rather than "I did not look".
        const ctx = await seedFullTask();

        const surfaces: Array<[string, WireTaskish]> = [];
        surfaces.push([
            "detail",
            (await ctx.client.get(`/api/v1/tasks/${ctx.task.id}`))
                .body as WireTaskish,
        ]);
        const listBody = (
            await ctx.client.get(`/api/v1/lists/${ctx.list.id}/tasks`)
        ).body as { data: WireTaskish[] };
        surfaces.push([
            "list",
            listBody.data.find((t) => t.id === ctx.task.id)!,
        ]);
        const myWork = (await ctx.client.get("/api/v1/tasks/my-work"))
            .body as Record<string, WireTaskish[]>;
        surfaces.push([
            "my-work",
            Object.values(myWork)
                .flat()
                .find((t) => t?.id === ctx.task.id)!,
        ]);

        for (const [label, body] of surfaces) {
            expect({ label, assignees: body.assignees }).toEqual({
                label,
                assignees: [ctx.owner.id],
            });
            expect({ label, watchers: body.watchers }).toEqual({
                label,
                watchers: [ctx.owner.id],
            });
            expect({ label, tags: body.tags }).toEqual({
                label,
                tags: [ctx.tag.id],
            });
            expect({
                label,
                cf: Object.keys(body.custom_field_values as object).length,
            }).toEqual({ label, cf: 1 });
        }
    });

    it("applies the assigned_by fallback identically everywhere", async () => {
        // The fallback (`assigned_by ?? created_by`) lives in the serializer
        // precisely so seven surfaces do not each have to remember it. This is
        // the test that says so.
        const ctx = await seedFullTask();
        await db()
            .update(tasks)
            .set({ assignedBy: null })
            .where(eq(tasks.id, ctx.task.id));

        const detail = (
            await ctx.client.get(`/api/v1/tasks/${ctx.task.id}`)
        ).body as WireTaskish;
        const listBody = (
            await ctx.client.get(`/api/v1/lists/${ctx.list.id}/tasks`)
        ).body as { data: WireTaskish[] };
        const fromList = listBody.data.find((t) => t.id === ctx.task.id)!;

        expect(detail.assigned_by).toBe(ctx.owner.id);
        expect(fromList.assigned_by).toBe(detail.assigned_by);
    });
});
