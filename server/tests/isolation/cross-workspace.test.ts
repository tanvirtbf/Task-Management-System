import { eq } from "drizzle-orm";
import { LoggedInClient } from "../test-utils/app";
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
    roles,
    taskDeleteRequests,
    taskDependencies,
    templates,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";

/* eslint-disable @typescript-eslint/no-var-requires -- `scripts/endpoints.cjs`
   is an operator script with no ESM entry point; requiring it is the only way
   to hold this suite to the live route table. */
const { allEndpoints } = require("../../scripts/endpoints.cjs") as {
    allEndpoints: () => Array<{ method: string; path: string; phase: string }>;
};
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * TENANT ISOLATION — one sweep, every `:id` endpoint, a neighbour's data.
 *
 * Each per-module suite checks its own corner of this, and unevenly: `lists`
 * has fourteen cross-workspace assertions, `workspace` and `rbac` have none.
 * That is the wrong shape for the property, because tenant isolation is not a
 * per-endpoint feature — it is one question asked of every endpoint that takes
 * an id, and it only takes ONE that answers differently for a customer's data
 * to be readable by another workspace.
 *
 * So: build two complete workspaces and ask it twice, from both directions.
 *
 * 1. **A neighbour's id in the URL** — the whole P3 surface, walked as A's
 *    owner holding B's ids. **404 every time.** 404 specifically, not merely
 *    "refused": a 403 would be a smaller leak and still a leak, because it
 *    separates "exists, forbidden" from "does not exist", and that difference
 *    is enough to enumerate a neighbour's spaces, lists and users one id at a
 *    time. The contract is that an id you cannot see does not exist.
 *
 * 2. **A neighbour's id in the BODY** — my list pointed at their space, my
 *    space given their user as its head, my template applied into their list.
 *    This is the direction that actually hides bugs: the handler resolves the
 *    thing it was asked about, authorises the caller for it, and then writes a
 *    foreign id into a column without ever asking whether the caller can see
 *    THAT. See the block below for what the measurements showed.
 *
 * The URL table is checked against the live route table (the same one
 * `npm run endpoints` prints), so a new `:id` route cannot be added without
 * either a probe here or a failing test naming it.
 */

jest.setTimeout(60000);

/**
 * The phases whose endpoints this sweep covers. Extend it — do not start a
 * second sweep — when a later phase adds routes; the completeness test reads
 * this list and will name anything left without a probe.
 */
const PHASES_COVERED = ["P3", "P4"];

interface Foreign {
    workspaceId: string;
    userId: string;
    secondUserId: string;
    spaceId: string;
    listId: string;
    statusId: string;
    taskTypeId: string;
    tagId: string;
    taskId: string;
    secondTaskId: string;
    dependencyId: string;
    deleteRequestId: string;
    templateId: string;
    customFieldId: string;
    roleId: string;
}

interface Probe {
    method: "get" | "post" | "patch" | "put" | "delete";
    /** Exactly as the route table declares it — the completeness check matches on this. */
    route: string;
    url: (b: Foreign) => string;
    /** Not always an object: the status reorder endpoint takes a bare array. */
    body?: (b: Foreign) => unknown;
}

const PROBES: Probe[] = [
    // ── users ───────────────────────────────────────────────────────────────
    { method: "get", route: "/api/v1/users/:id", url: (b) => `/api/v1/users/${b.userId}` },
    {
        method: "patch",
        route: "/api/v1/users/:id",
        url: (b) => `/api/v1/users/${b.userId}`,
        body: () => ({ first_name: "Probe" }),
    },
    {
        method: "patch",
        route: "/api/v1/users/:id/role",
        url: (b) => `/api/v1/users/${b.userId}/role`,
        body: () => ({ role: "member" }),
    },
    { method: "post", route: "/api/v1/users/:id/deactivate", url: (b) => `/api/v1/users/${b.userId}/deactivate` },
    { method: "post", route: "/api/v1/users/:id/reactivate", url: (b) => `/api/v1/users/${b.userId}/reactivate` },
    { method: "get", route: "/api/v1/users/:id/deletion-preflight", url: (b) => `/api/v1/users/${b.userId}/deletion-preflight` },
    { method: "delete", route: "/api/v1/users/:id", url: (b) => `/api/v1/users/${b.userId}` },
    { method: "post", route: "/api/v1/users/:id/reset-password", url: (b) => `/api/v1/users/${b.userId}/reset-password` },
    { method: "get", route: "/api/v1/users/:id/roles", url: (b) => `/api/v1/users/${b.userId}/roles` },
    {
        method: "patch",
        route: "/api/v1/users/:id/team",
        url: (b) => `/api/v1/users/${b.userId}/team`,
        // A real attempt to MOVE a neighbour's user into a team, not a clear:
        // `{space_id: null}` would be a no-op and could answer 204 without ever
        // resolving the user.
        body: (b) => ({ space_id: b.spaceId }),
    },

    // ── spaces ──────────────────────────────────────────────────────────────
    { method: "get", route: "/api/v1/spaces/:id", url: (b) => `/api/v1/spaces/${b.spaceId}` },
    {
        method: "patch",
        route: "/api/v1/spaces/:id",
        url: (b) => `/api/v1/spaces/${b.spaceId}`,
        body: () => ({ name: "Probe" }),
    },
    { method: "post", route: "/api/v1/spaces/:id/archive", url: (b) => `/api/v1/spaces/${b.spaceId}/archive` },
    { method: "post", route: "/api/v1/spaces/:id/unarchive", url: (b) => `/api/v1/spaces/${b.spaceId}/unarchive` },
    { method: "delete", route: "/api/v1/spaces/:id", url: (b) => `/api/v1/spaces/${b.spaceId}` },
    { method: "get", route: "/api/v1/spaces/:id/review-summary", url: (b) => `/api/v1/spaces/${b.spaceId}/review-summary` },
    {
        method: "get",
        route: "/api/v1/spaces/:id/review-queue",
        // `bucket` is a required query param; without it the 422 arrives before
        // the space is ever looked up and the probe proves nothing.
        url: (b) => `/api/v1/spaces/${b.spaceId}/review-queue?bucket=needs_review`,
    },
    { method: "get", route: "/api/v1/spaces/:id/members", url: (b) => `/api/v1/spaces/${b.spaceId}/members` },
    {
        method: "post",
        route: "/api/v1/spaces/:id/members",
        url: (b) => `/api/v1/spaces/${b.spaceId}/members`,
        body: (b) => ({ user_id: b.secondUserId }),
    },
    {
        method: "delete",
        route: "/api/v1/spaces/:id/members/:userId",
        url: (b) => `/api/v1/spaces/${b.spaceId}/members/${b.secondUserId}`,
    },
    {
        method: "post",
        route: "/api/v1/spaces/:id/visibility-grants",
        url: (b) => `/api/v1/spaces/${b.spaceId}/visibility-grants`,
        body: (b) => ({ target_space_id: b.spaceId }),
    },
    {
        method: "delete",
        route: "/api/v1/spaces/:id/visibility-grants/:targetId",
        url: (b) => `/api/v1/spaces/${b.spaceId}/visibility-grants/${b.secondUserId}`,
    },
    { method: "get", route: "/api/v1/spaces/:spaceId/lists", url: (b) => `/api/v1/spaces/${b.spaceId}/lists` },

    // ── lists ───────────────────────────────────────────────────────────────
    { method: "get", route: "/api/v1/lists/:id", url: (b) => `/api/v1/lists/${b.listId}` },
    {
        method: "patch",
        route: "/api/v1/lists/:id",
        url: (b) => `/api/v1/lists/${b.listId}`,
        body: () => ({ name: "Probe" }),
    },
    { method: "post", route: "/api/v1/lists/:id/archive", url: (b) => `/api/v1/lists/${b.listId}/archive` },
    { method: "post", route: "/api/v1/lists/:id/unarchive", url: (b) => `/api/v1/lists/${b.listId}/unarchive` },
    { method: "delete", route: "/api/v1/lists/:id", url: (b) => `/api/v1/lists/${b.listId}` },
    { method: "get", route: "/api/v1/lists/:listId/tasks", url: (b) => `/api/v1/lists/${b.listId}/tasks` },
    { method: "get", route: "/api/v1/lists/:listId/custom-fields", url: (b) => `/api/v1/lists/${b.listId}/custom-fields` },

    // ── statuses ────────────────────────────────────────────────────────────
    { method: "get", route: "/api/v1/lists/:listId/statuses", url: (b) => `/api/v1/lists/${b.listId}/statuses` },
    {
        method: "post",
        route: "/api/v1/lists/:listId/statuses",
        url: (b) => `/api/v1/lists/${b.listId}/statuses`,
        body: () => ({ name: "Probe", status_group: "active" }),
    },
    {
        method: "patch",
        route: "/api/v1/lists/:listId/statuses/reorder",
        url: (b) => `/api/v1/lists/${b.listId}/statuses/reorder`,
        // A bare array of {id, position} — the controller parses the BODY
        // itself rather than a named field.
        body: (b) => [{ id: b.statusId, position: 0 }],
    },
    {
        method: "patch",
        route: "/api/v1/statuses/:id",
        url: (b) => `/api/v1/statuses/${b.statusId}`,
        body: () => ({ name: "Probe" }),
    },
    { method: "delete", route: "/api/v1/statuses/:id", url: (b) => `/api/v1/statuses/${b.statusId}` },

    // ── task types & tags ───────────────────────────────────────────────────
    {
        method: "patch",
        route: "/api/v1/task-types/:id",
        url: (b) => `/api/v1/task-types/${b.taskTypeId}`,
        body: () => ({ name: "Probe" }),
    },
    { method: "delete", route: "/api/v1/task-types/:id", url: (b) => `/api/v1/task-types/${b.taskTypeId}` },
    {
        method: "patch",
        route: "/api/v1/tags/:id",
        url: (b) => `/api/v1/tags/${b.tagId}`,
        body: () => ({ name: "probe-tag" }),
    },
    { method: "delete", route: "/api/v1/tags/:id", url: (b) => `/api/v1/tags/${b.tagId}` },

    // ── templates ───────────────────────────────────────────────────────────
    { method: "get", route: "/api/v1/templates/:id", url: (b) => `/api/v1/templates/${b.templateId}` },
    {
        method: "patch",
        route: "/api/v1/templates/:id",
        url: (b) => `/api/v1/templates/${b.templateId}`,
        body: () => ({ name: "Probe" }),
    },
    { method: "delete", route: "/api/v1/templates/:id", url: (b) => `/api/v1/templates/${b.templateId}` },
    {
        method: "post",
        route: "/api/v1/templates/:id/apply",
        url: (b) => `/api/v1/templates/${b.templateId}/apply`,
        body: (b) => ({ list_id: b.listId, name: "Probe" }),
    },

    // ── custom fields ───────────────────────────────────────────────────────
    {
        method: "patch",
        route: "/api/v1/custom-fields/:id",
        url: (b) => `/api/v1/custom-fields/${b.customFieldId}`,
        body: () => ({ name: "Probe" }),
    },
    { method: "delete", route: "/api/v1/custom-fields/:id", url: (b) => `/api/v1/custom-fields/${b.customFieldId}` },
    {
        method: "put",
        route: "/api/v1/tasks/:id/custom-fields/:fieldId",
        url: (b) => `/api/v1/tasks/${b.taskId}/custom-fields/${b.customFieldId}`,
        body: () => ({ value: "probe" }),
    },
    {
        method: "delete",
        route: "/api/v1/tasks/:id/custom-fields/:fieldId",
        url: (b) => `/api/v1/tasks/${b.taskId}/custom-fields/${b.customFieldId}`,
    },

    // ── roles (read side) ───────────────────────────────────────────────────
    { method: "get", route: "/api/v1/roles/:id/holders", url: (b) => `/api/v1/roles/${b.roleId}/holders` },

    // ═══ P4 — tasks core ════════════════════════════════════════════════════
    { method: "get", route: "/api/v1/tasks/:id", url: (b) => `/api/v1/tasks/${b.taskId}` },
    {
        method: "patch",
        route: "/api/v1/tasks/:id",
        url: (b) => `/api/v1/tasks/${b.taskId}`,
        body: () => ({ name: "Probe" }),
    },
    { method: "delete", route: "/api/v1/tasks/:id", url: (b) => `/api/v1/tasks/${b.taskId}` },
    { method: "post", route: "/api/v1/tasks/:id/archive", url: (b) => `/api/v1/tasks/${b.taskId}/archive` },
    { method: "post", route: "/api/v1/tasks/:id/unarchive", url: (b) => `/api/v1/tasks/${b.taskId}/unarchive` },
    { method: "get", route: "/api/v1/tasks/:id/subtasks", url: (b) => `/api/v1/tasks/${b.taskId}/subtasks` },
    { method: "get", route: "/api/v1/tasks/:id/activity", url: (b) => `/api/v1/tasks/${b.taskId}/activity` },
    { method: "get", route: "/api/v1/tasks/:id/reviews", url: (b) => `/api/v1/tasks/${b.taskId}/reviews` },
    { method: "get", route: "/api/v1/tasks/:id/dependencies", url: (b) => `/api/v1/tasks/${b.taskId}/dependencies` },
    {
        method: "post",
        route: "/api/v1/tasks/:id/assignees",
        url: (b) => `/api/v1/tasks/${b.taskId}/assignees`,
        body: (b) => ({ user_ids: [b.secondUserId] }),
    },
    {
        method: "delete",
        route: "/api/v1/tasks/:id/assignees/:userId",
        url: (b) => `/api/v1/tasks/${b.taskId}/assignees/${b.secondUserId}`,
    },
    { method: "post", route: "/api/v1/tasks/:id/watchers/self", url: (b) => `/api/v1/tasks/${b.taskId}/watchers/self` },
    { method: "delete", route: "/api/v1/tasks/:id/watchers/self", url: (b) => `/api/v1/tasks/${b.taskId}/watchers/self` },
    {
        method: "post",
        route: "/api/v1/tasks/:id/tags",
        url: (b) => `/api/v1/tasks/${b.taskId}/tags`,
        body: (b) => ({ tag_ids: [b.tagId] }),
    },
    {
        method: "delete",
        route: "/api/v1/tasks/:id/tags/:tagId",
        url: (b) => `/api/v1/tasks/${b.taskId}/tags/${b.tagId}`,
    },
    {
        method: "post",
        route: "/api/v1/tasks/:id/review",
        url: (b) => `/api/v1/tasks/${b.taskId}/review`,
        body: () => ({ status: "approved" }),
    },
    {
        method: "patch",
        route: "/api/v1/tasks/:id/sla",
        url: (b) => `/api/v1/tasks/${b.taskId}/sla`,
        body: () => ({ sla_due_at: "2027-01-01T00:00:00.000Z" }),
    },
    {
        method: "post",
        route: "/api/v1/tasks/:id/delete-request",
        url: (b) => `/api/v1/tasks/${b.taskId}/delete-request`,
        body: () => ({ reason: "probe" }),
    },
    { method: "get", route: "/api/v1/tasks/:id/delete-request", url: (b) => `/api/v1/tasks/${b.taskId}/delete-request` },
    { method: "delete", route: "/api/v1/task-dependencies/:id", url: (b) => `/api/v1/task-dependencies/${b.dependencyId}` },
    {
        method: "post",
        route: "/api/v1/delete-requests/:id/approve",
        url: (b) => `/api/v1/delete-requests/${b.deleteRequestId}/approve`,
    },
    {
        method: "post",
        route: "/api/v1/delete-requests/:id/reject",
        url: (b) => `/api/v1/delete-requests/${b.deleteRequestId}/reject`,
    },
    {
        method: "post",
        route: "/api/v1/delete-requests/:id/cancel",
        url: (b) => `/api/v1/delete-requests/${b.deleteRequestId}/cancel`,
    },
];

/** Workspace B — a neighbour with one of everything. */
const buildForeign = async (): Promise<Foreign> => {
    const db = getDb();
    const ws = await makeWorkspace({ name: "Neighbour Ltd" });
    const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
    const second = await makeUser({ workspaceId: ws.id, role: "member" });
    const space = await makeSpace({ workspaceId: ws.id, createdBy: owner.id });
    const list = await makeList({
        workspaceId: ws.id,
        spaceId: space.id,
        createdBy: owner.id,
    });
    const status = await makeStatus({ scopeId: list.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    const tag = await makeTag({ workspaceId: ws.id });
    const task = await makeTask({
        workspaceId: ws.id,
        createdBy: owner.id,
        listId: list.id,
        statusId: status.id,
        taskTypeId: taskType.id,
    });

    const templateId = fakeId("tpl");
    await db.insert(templates).values({
        id: templateId,
        workspaceId: ws.id,
        type: "task",
        name: "Neighbour playbook",
        structure: {
            checklistName: "Playbook",
            checklistItems: [{ text: "First step", dueOffsetDays: 0 }],
        },
        createdBy: owner.id,
    });

    const customFieldId = fakeId("cf");
    await db.insert(customFields).values({
        id: customFieldId,
        workspaceId: ws.id,
        name: "Neighbour field",
        type: "text",
        scopeType: "workspace",
        scopeId: null,
        createdBy: owner.id,
    });

    // A second task, so B can own a dependency between two of its own tasks.
    const secondTask = await makeTask({
        workspaceId: ws.id,
        createdBy: owner.id,
        listId: list.id,
        statusId: status.id,
        taskTypeId: taskType.id,
    });

    const dependencyId = fakeId("dep");
    await db.insert(taskDependencies).values({
        id: dependencyId,
        taskId: task.id,
        relatedTaskId: secondTask.id,
        depType: "blocks",
        createdBy: owner.id,
    });

    const deleteRequestId = fakeId("tdr");
    await db.insert(taskDeleteRequests).values({
        id: deleteRequestId,
        workspaceId: ws.id,
        spaceId: space.id,
        taskId: secondTask.id,
        taskName: "Neighbour task",
        requestedBy: owner.id,
        reason: "housekeeping",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    // `makeWorkspace` seeds the four system roles, which is what a real
    // deployment looks like — so B always has a role id to probe.
    const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.workspaceId, ws.id))
        .limit(1);

    return {
        workspaceId: ws.id,
        userId: owner.id,
        secondUserId: second.id,
        spaceId: space.id,
        listId: list.id,
        statusId: status.id,
        taskTypeId: taskType.id,
        tagId: tag.id,
        taskId: task.id,
        secondTaskId: secondTask.id,
        dependencyId,
        deleteRequestId,
        templateId,
        customFieldId,
        roleId: role.id,
    };
};

/** Workspace A — ours, with enough of a graph to be a plausible container. */
interface Mine {
    workspaceId: string;
    userId: string;
    spaceId: string;
    listId: string;
    statusId: string;
    taskTypeId: string;
    taskId: string;
}

describe("Tenant isolation — a neighbour's ids are simply not there", () => {
    let client: LoggedInClient;
    let mine: Mine;
    let foreign: Foreign;

    beforeEach(async () => {
        const ws = await makeWorkspace({ name: "Us Ltd" });
        // The OWNER of workspace A: the most powerful principal there is, so a
        // 404 here cannot be explained away as "that role could not have done
        // it anyway". If anyone could reach across, it would be this account.
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        client = await makeLoggedInClient(owner);

        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });
        const list = await makeList({
            workspaceId: ws.id,
            spaceId: space.id,
            createdBy: owner.id,
        });
        const status = await makeStatus({ scopeId: list.id });
        const taskType = await makeTaskType({ workspaceId: ws.id });
        const task = await makeTask({
            workspaceId: ws.id,
            createdBy: owner.id,
            listId: list.id,
            statusId: status.id,
            taskTypeId: taskType.id,
        });
        mine = {
            workspaceId: ws.id,
            userId: owner.id,
            spaceId: space.id,
            listId: list.id,
            statusId: status.id,
            taskTypeId: taskType.id,
            taskId: task.id,
        };

        foreign = await buildForeign();
    });

    it("has a probe for every P3 endpoint that takes an id", () => {
        // Read from the live route table rather than a copy, so adding a route
        // with an `:id` and no probe fails HERE, naming it — instead of the new
        // endpoint quietly never being asked the question.
        const needed = allEndpoints()
            .filter(
                (e) =>
                    PHASES_COVERED.includes(e.phase) && e.path.includes("/:"),
            )
            .map((e) => `${e.method} ${e.path}`);
        const covered = new Set(
            PROBES.map((p) => `${p.method.toUpperCase()} ${p.route}`),
        );
        expect(needed.filter((n) => !covered.has(n))).toEqual([]);
    });

    /**
     * The other direction, and the one that actually hides bugs.
     *
     * Above, the URL carries a neighbour's id — the obvious case, and the one
     * everybody remembers to guard, because the resource lookup is the first
     * thing the handler does. Here the container is MINE and a neighbour's id
     * rides in the BODY: my new list pointed at their space, my space given
     * their user as its head, my template applied into their list.
     *
     * That is the confused-deputy shape. The handler resolves the thing it was
     * asked about, finds it, authorises the caller for it — and then writes a
     * foreign id into a column without ever asking whether the caller can see
     * THAT. Nothing about the request looks suspicious.
     *
     * Measured result: all eight are refused, none with a 2xx. Three answer
     * 404 and five answer 422, and the split is not arbitrary — it says which
     * layer noticed. A 404 means the service resolved the referenced row
     * inside the caller's workspace and found nothing; a 422 means the
     * validator rejected the field before the service ever looked. Both are
     * safe; the codes are pinned so a change of layer becomes visible rather
     * than silent. The property that actually matters is asserted separately
     * and does not depend on the exact code: the response is never a success.
     */
    describe("a neighbour's id in the BODY, not the URL", () => {
        interface BodyProbe {
            label: string;
            run: (mine: Mine, theirs: Foreign) => Promise<{ status: number }>;
            /** The refusal this endpoint currently gives. */
            expected: number;
        }

        const BODY_PROBES: BodyProbe[] = [
            {
                label: "POST /lists with a neighbour's space_id",
                expected: 404,
                run: (mine, theirs) =>
                    client.post("/api/v1/lists").send({
                        space_id: theirs.spaceId,
                        name: "Smuggled list",
                    }),
            },
            {
                label: "POST /lists with a neighbour's default_task_type_id",
                expected: 422,
                run: (mine, theirs) =>
                    client.post("/api/v1/lists").send({
                        space_id: mine.spaceId,
                        name: "Smuggled type",
                        default_task_type_id: theirs.taskTypeId,
                    }),
            },
            {
                label: "PATCH /lists/:id moving MY list into their space",
                expected: 404,
                run: (mine, theirs) =>
                    client
                        .patch(`/api/v1/lists/${mine.listId}`)
                        .send({ space_id: theirs.spaceId }),
            },
            {
                label: "PATCH /spaces/:id making their user MY space's head",
                expected: 422,
                run: (mine, theirs) =>
                    client
                        .patch(`/api/v1/spaces/${mine.spaceId}`)
                        .send({ head_user_id: theirs.userId }),
            },
            {
                label: "POST /spaces/:id/members adding their user to MY space",
                expected: 404,
                run: (mine, theirs) =>
                    client
                        .post(`/api/v1/spaces/${mine.spaceId}/members`)
                        .send({ user_id: theirs.userId }),
            },
            {
                label: "POST /spaces/:id/visibility-grants pointing at their space",
                expected: 422,
                run: (mine, theirs) =>
                    client
                        .post(`/api/v1/spaces/${mine.spaceId}/visibility-grants`)
                        .send({ target_space_id: theirs.spaceId }),
            },
            {
                label: "PATCH /users/:id/team putting MY user in their space",
                expected: 422,
                run: (mine, theirs) =>
                    client
                        .patch(`/api/v1/users/${mine.userId}/team`)
                        .send({ space_id: theirs.spaceId }),
            },
            {
                label: "POST /custom-fields scoped to their list",
                expected: 422,
                run: (mine, theirs) =>
                    client.post("/api/v1/custom-fields").send({
                        scope_type: "list",
                        scope_id: theirs.listId,
                        name: "Smuggled field",
                        type: "text",
                    }),
            },

            // ── P4 ──────────────────────────────────────────────────────────
            {
                label: "POST /tasks into their list",
                expected: 404,
                run: (mine, theirs) =>
                    client.post("/api/v1/tasks").send({
                        primary_list_id: theirs.listId,
                        name: "Smuggled task",
                    }),
            },
            {
                label: "POST /tasks in MY list with their status_id",
                expected: 422,
                run: (mine, theirs) =>
                    client.post("/api/v1/tasks").send({
                        primary_list_id: mine.listId,
                        name: "Smuggled status",
                        status_id: theirs.statusId,
                    }),
            },
            {
                label: "POST /tasks in MY list with their task_type_id",
                expected: 422,
                run: (mine, theirs) =>
                    client.post("/api/v1/tasks").send({
                        primary_list_id: mine.listId,
                        name: "Smuggled type",
                        task_type_id: theirs.taskTypeId,
                    }),
            },
            {
                label: "POST /tasks/:id/assignees adding their user to MY task",
                expected: 422,
                run: (mine, theirs) =>
                    client
                        .post(`/api/v1/tasks/${mine.taskId}/assignees`)
                        .send({ user_ids: [theirs.userId] }),
            },
            {
                label: "POST /tasks/:id/tags putting their tag on MY task",
                expected: 422,
                run: (mine, theirs) =>
                    client
                        .post(`/api/v1/tasks/${mine.taskId}/tags`)
                        .send({ tag_ids: [theirs.tagId] }),
            },
            {
                label: "POST /task-dependencies linking MY task to theirs",
                expected: 404,
                run: (mine, theirs) =>
                    client.post("/api/v1/task-dependencies").send({
                        task_id: mine.taskId,
                        related_task_id: theirs.taskId,
                        type: "blocks",
                    }),
            },
            {
                label: "POST /tasks/bulk over their task ids",
                expected: 404,
                run: (mine, theirs) =>
                    client.post("/api/v1/tasks/bulk").send({
                        ids: [theirs.taskId],
                        patch: { priority: 1 },
                    }),
            },
        ];

        it.each(BODY_PROBES.map((p) => [p.label, p] as const))(
            "%s is refused",
            async (label, probe) => {
                const res = await probe.run(mine, foreign);

                // Stated as an object so a failure prints WHICH probe and what
                // it actually got, rather than a bare number.
                expect({ label, status: res.status }).toEqual({
                    label,
                    status: probe.expected,
                });
                expect(res.status).toBeGreaterThanOrEqual(400);
            },
        );
    });

    it.each(PROBES.map((p) => [`${p.method.toUpperCase()} ${p.route}`, p] as const))(
        "%s → 404",
        async (_label, probe) => {
            const req = client[probe.method](probe.url(foreign));
            // supertest types `send` as string | object; the reorder endpoint's
            // body is an array, which IS an object at runtime.
            const res = probe.body
                ? await req.send(probe.body(foreign) as object)
                : await req;

            // A 403 would be the interesting failure: it would mean the system
            // knows the row exists and is telling the caller so.
            expect({
                endpoint: `${probe.method.toUpperCase()} ${probe.route}`,
                status: res.status,
            }).toEqual({
                endpoint: `${probe.method.toUpperCase()} ${probe.route}`,
                status: 404,
            });
        },
    );
});
