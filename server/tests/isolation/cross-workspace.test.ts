import { eq } from "drizzle-orm";
import { LoggedInClient } from "../test-utils/app";
import {
    makeList,
    makeLoggedInClient,
    makeSpace,
    makeSprint,
    makeStatus,
    makeTag,
    makeTask,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    attachments,
    checklistItems,
    checklists,
    comments,
    customFields,
    departmentReports,
    formFields,
    forms,
    notifications,
    onCallShifts,
    roles,
    tasks,
    taskAssignmentRequests,
    taskDeleteRequests,
    taskDependencies,
    templates,
    userRoleGrants,
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
const PHASES_COVERED = ["P3", "P4", "P5", "P6", "P7"];

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
    // ── P5: the collaboration graph hanging off B's task ────────────────────
    notificationId: string;
    attachmentId: string;
    assignmentRequestId: string;
    commentId: string;
    checklistId: string;
    checklistItemId: string;
    // ── P6: the read models and product surfaces ────────────────────────────
    reportId: string;
    formId: string;
    formFieldId: string;
    sprintId: string;
    // ── P7: an actual role ASSIGNMENT of B's, to revoke ──────────────────────
    roleAssignmentId: string;
}

interface Probe {
    method: "get" | "post" | "patch" | "put" | "delete";
    /** Exactly as the route table declares it — the completeness check matches on this. */
    route: string;
    url: (b: Foreign) => string;
    /** Not always an object: the status reorder endpoint takes a bare array. */
    body?: (b: Foreign) => unknown;
    /**
     * For the routes that do not take JSON. `POST /tasks/:id/attachments` is a
     * proxied upload: raw bytes, with the name in `X-Filename`. Probing it with
     * a JSON body only proves the body parser rejects JSON, which says nothing
     * about whose task it is.
     */
    headers?: Record<string, string>;
}

/**
 * Routes whose path parameter is not an identifier a neighbour owns, so "hold
 * their id and expect a 404" is not a question that can be asked of them.
 *
 * Excluding is not the same as not testing: each is covered where the property
 * actually lives, and the reason is written here rather than in someone's head.
 */
const NOT_AN_ID_PROBE = new Set([
    // 🔓 PUBLIC by design. A published form is meant to be openable by anyone
    // holding the link — that is the entire feature, and the slug is the
    // capability. Answering 404 to another workspace's owner would break it
    // for every customer too. What DOES matter is that submitting through it
    // cannot reach across tenants, and that is asserted in the body direction
    // below (`public submit lands in the form's OWN workspace`).
    "GET /api/v1/public/forms/:slug",
    "POST /api/v1/public/forms/:slug/submit",
    // The parameter is a DATE (`2026-09-07`), identical in every workspace, so
    // there is no foreign id to hold. The isolation question here is about the
    // EFFECT, not the lookup — asserted in the body direction below
    // (`writing my on-call week leaves the neighbour's untouched`).
    "PUT /api/v1/on-call/:weekStart",
    "DELETE /api/v1/on-call/:weekStart",
]);

/**
 * Endpoints that answer something other than 404 to a stranger's id, and why.
 *
 * 404 is the rule everywhere else, because a 403 concedes that the row exists.
 * §19 Notifications is the one documented departure: `NotificationsService`
 * states it deliberately — a missing row is 404 `notification.not_found`, and
 * ANOTHER USER'S row is 403 `notification.not_owner`, per the spec, on the
 * reasoning that notification ids are unguessable so the distinction is not a
 * usable enumeration oracle.
 *
 * Listing it here rather than loosening the assertion to "any 4xx" keeps the
 * exception a decision somebody made, visible in one place, instead of a hole
 * the sweep would stop noticing.
 */
const EXPECTED_STATUS: Record<string, number> = {
    "post /api/v1/notifications/:id/read": 403,
    "post /api/v1/notifications/:id/unread": 403,
    "post /api/v1/notifications/:id/snooze": 403,
    "delete /api/v1/notifications/:id": 403,
};

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

    // ── P5: notifications ───────────────────────────────────────────────────
    // A notification is addressed to a PERSON, so the boundary here is the
    // recipient rather than the workspace — but the effect must be the same.
    {
        method: "post",
        route: "/api/v1/notifications/:id/read",
        url: (b) => `/api/v1/notifications/${b.notificationId}/read`,
    },
    {
        method: "post",
        route: "/api/v1/notifications/:id/unread",
        url: (b) => `/api/v1/notifications/${b.notificationId}/unread`,
    },
    {
        method: "post",
        route: "/api/v1/notifications/:id/snooze",
        url: (b) => `/api/v1/notifications/${b.notificationId}/snooze`,
        body: () => ({
            snoozed_until: new Date(Date.now() + 3600_000).toISOString(),
        }),
    },
    {
        method: "delete",
        route: "/api/v1/notifications/:id",
        url: (b) => `/api/v1/notifications/${b.notificationId}`,
    },

    // ── P5: attachments ─────────────────────────────────────────────────────
    // The download probe is the one that would hurt: a signed URL handed to an
    // outsider is the file itself, not a reference to it.
    {
        method: "post",
        route: "/api/v1/attachments/:id/finalize",
        url: (b) => `/api/v1/attachments/${b.attachmentId}/finalize`,
        body: () => ({}),
    },
    {
        method: "get",
        route: "/api/v1/attachments/:id/download",
        url: (b) => `/api/v1/attachments/${b.attachmentId}/download`,
    },
    {
        method: "delete",
        route: "/api/v1/attachments/:id",
        url: (b) => `/api/v1/attachments/${b.attachmentId}`,
    },
    {
        method: "get",
        route: "/api/v1/tasks/:id/attachments",
        url: (b) => `/api/v1/tasks/${b.taskId}/attachments`,
    },
    {
        method: "post",
        route: "/api/v1/tasks/:id/attachments",
        url: (b) => `/api/v1/tasks/${b.taskId}/attachments`,
        headers: {
            "X-Filename": "probe.pdf",
            "Content-Type": "application/pdf",
        },
        body: () => Buffer.from("probe bytes"),
    },

    // ── P5: assignment requests ─────────────────────────────────────────────
    {
        method: "get",
        route: "/api/v1/tasks/:id/assignment-requests",
        url: (b) => `/api/v1/tasks/${b.taskId}/assignment-requests`,
    },
    {
        method: "post",
        route: "/api/v1/assignment-requests/:id/accept",
        url: (b) => `/api/v1/assignment-requests/${b.assignmentRequestId}/accept`,
    },
    {
        method: "post",
        route: "/api/v1/assignment-requests/:id/decline",
        url: (b) =>
            `/api/v1/assignment-requests/${b.assignmentRequestId}/decline`,
    },
    {
        method: "post",
        route: "/api/v1/assignment-requests/:id/query",
        url: (b) => `/api/v1/assignment-requests/${b.assignmentRequestId}/query`,
        body: () => ({ note: "probe" }),
    },
    {
        method: "post",
        route: "/api/v1/assignment-requests/:id/answer",
        url: (b) =>
            `/api/v1/assignment-requests/${b.assignmentRequestId}/answer`,
        body: () => ({ note: "probe" }),
    },
    {
        method: "post",
        route: "/api/v1/assignment-requests/:id/cancel",
        url: (b) =>
            `/api/v1/assignment-requests/${b.assignmentRequestId}/cancel`,
    },

    // ── P5: comments ────────────────────────────────────────────────────────
    {
        method: "get",
        route: "/api/v1/tasks/:id/comments",
        url: (b) => `/api/v1/tasks/${b.taskId}/comments`,
    },
    {
        method: "post",
        route: "/api/v1/tasks/:id/comments",
        url: (b) => `/api/v1/tasks/${b.taskId}/comments`,
        body: () => ({ body: "probe" }),
    },
    {
        method: "patch",
        route: "/api/v1/comments/:id",
        url: (b) => `/api/v1/comments/${b.commentId}`,
        body: () => ({ body: "probe" }),
    },
    {
        method: "delete",
        route: "/api/v1/comments/:id",
        url: (b) => `/api/v1/comments/${b.commentId}`,
    },

    // ── P5: checklists ──────────────────────────────────────────────────────
    {
        method: "get",
        route: "/api/v1/tasks/:id/checklists",
        url: (b) => `/api/v1/tasks/${b.taskId}/checklists`,
    },
    {
        method: "post",
        route: "/api/v1/tasks/:id/checklists",
        url: (b) => `/api/v1/tasks/${b.taskId}/checklists`,
        body: () => ({ name: "probe" }),
    },
    {
        method: "patch",
        route: "/api/v1/checklists/:id",
        url: (b) => `/api/v1/checklists/${b.checklistId}`,
        body: () => ({ name: "probe" }),
    },
    {
        method: "delete",
        route: "/api/v1/checklists/:id",
        url: (b) => `/api/v1/checklists/${b.checklistId}`,
    },
    {
        method: "post",
        route: "/api/v1/checklists/:id/items",
        url: (b) => `/api/v1/checklists/${b.checklistId}/items`,
        body: () => ({ text: "probe" }),
    },
    {
        method: "post",
        route: "/api/v1/checklists/:id/items/bulk",
        url: (b) => `/api/v1/checklists/${b.checklistId}/items/bulk`,
        body: () => ({ texts: ["probe"] }),
    },
    {
        method: "patch",
        route: "/api/v1/checklist-items/:id",
        url: (b) => `/api/v1/checklist-items/${b.checklistItemId}`,
        body: () => ({ text: "probe" }),
    },
    {
        method: "post",
        route: "/api/v1/checklist-items/:id/toggle",
        url: (b) => `/api/v1/checklist-items/${b.checklistItemId}/toggle`,
    },
    {
        method: "delete",
        route: "/api/v1/checklist-items/:id",
        url: (b) => `/api/v1/checklist-items/${b.checklistItemId}`,
    },

    // ── P6: reports ─────────────────────────────────────────────────────────
    {
        method: "get",
        route: "/api/v1/reports/:id",
        url: (b) => `/api/v1/reports/${b.reportId}`,
    },
    {
        method: "patch",
        route: "/api/v1/reports/:id",
        url: (b) => `/api/v1/reports/${b.reportId}`,
        body: () => ({ head_note: "probe" }),
    },
    {
        method: "post",
        route: "/api/v1/reports/:id/ack",
        url: (b) => `/api/v1/reports/${b.reportId}/ack`,
    },

    // ── P6: forms ───────────────────────────────────────────────────────────
    {
        method: "get",
        route: "/api/v1/lists/:listId/forms",
        url: (b) => `/api/v1/lists/${b.listId}/forms`,
    },
    {
        method: "get",
        route: "/api/v1/forms/:id",
        url: (b) => `/api/v1/forms/${b.formId}`,
    },
    {
        method: "patch",
        route: "/api/v1/forms/:id",
        url: (b) => `/api/v1/forms/${b.formId}`,
        body: () => ({ title: "Probe" }),
    },
    {
        method: "delete",
        route: "/api/v1/forms/:id",
        url: (b) => `/api/v1/forms/${b.formId}`,
    },
    {
        method: "get",
        route: "/api/v1/forms/:id/submissions",
        url: (b) => `/api/v1/forms/${b.formId}/submissions`,
    },
    {
        method: "post",
        route: "/api/v1/forms/:id/fields",
        url: (b) => `/api/v1/forms/${b.formId}/fields`,
        body: () => ({
            field_kind: "task_attr",
            field_key: "name",
            label: "Probe",
        }),
    },
    {
        method: "patch",
        route: "/api/v1/forms/:id/fields/reorder",
        url: (b) => `/api/v1/forms/${b.formId}/fields/reorder`,
        body: (b) => ({ items: [{ id: b.formFieldId, position: 0 }] }),
    },
    {
        method: "patch",
        route: "/api/v1/form-fields/:id",
        url: (b) => `/api/v1/form-fields/${b.formFieldId}`,
        body: () => ({ label: "Probe" }),
    },
    {
        method: "delete",
        route: "/api/v1/form-fields/:id",
        url: (b) => `/api/v1/form-fields/${b.formFieldId}`,
    },

    // ── P6: sprints ─────────────────────────────────────────────────────────
    {
        method: "get",
        route: "/api/v1/sprints/:id",
        url: (b) => `/api/v1/sprints/${b.sprintId}`,
    },
    {
        method: "patch",
        route: "/api/v1/sprints/:id",
        url: (b) => `/api/v1/sprints/${b.sprintId}`,
        body: () => ({ name: "Probe" }),
    },
    {
        method: "delete",
        route: "/api/v1/sprints/:id",
        url: (b) => `/api/v1/sprints/${b.sprintId}`,
    },
    {
        method: "post",
        route: "/api/v1/sprints/:id/start",
        url: (b) => `/api/v1/sprints/${b.sprintId}/start`,
    },
    {
        method: "post",
        route: "/api/v1/sprints/:id/close",
        url: (b) => `/api/v1/sprints/${b.sprintId}/close`,
    },
    {
        method: "get",
        route: "/api/v1/sprints/:id/tasks",
        url: (b) => `/api/v1/sprints/${b.sprintId}/tasks`,
    },
    {
        method: "post",
        route: "/api/v1/sprints/:id/tasks",
        url: (b) => `/api/v1/sprints/${b.sprintId}/tasks`,
        body: (b) => ({ task_ids: [b.taskId] }),
    },
    {
        method: "delete",
        route: "/api/v1/sprints/:id/tasks/:taskId",
        url: (b) => `/api/v1/sprints/${b.sprintId}/tasks/${b.taskId}`,
    },

    // ── P7: the roles WRITE surface ─────────────────────────────────────────
    // The sharpest family in the sweep: these endpoints GRANT things. Reaching
    // a neighbour's role would not read their data, it would let you hand
    // yourself their permissions.
    {
        method: "patch",
        route: "/api/v1/roles/:id",
        url: (b) => `/api/v1/roles/${b.roleId}`,
        body: () => ({ name: "Probe" }),
    },
    {
        method: "put",
        route: "/api/v1/roles/:id/permissions",
        url: (b) => `/api/v1/roles/${b.roleId}/permissions`,
        body: () => ({ permissions: [{ key: "space.view", scope: "all" }] }),
    },
    {
        method: "delete",
        route: "/api/v1/roles/:id",
        url: (b) => `/api/v1/roles/${b.roleId}`,
    },
    {
        method: "post",
        route: "/api/v1/users/:id/roles",
        url: (b) => `/api/v1/users/${b.userId}/roles`,
        body: (b) => ({ role_id: b.roleId }),
    },
    {
        method: "delete",
        route: "/api/v1/users/:id/roles/:assignmentId",
        url: (b) => `/api/v1/users/${b.userId}/roles/${b.roleAssignmentId}`,
    },

    // ── P6: engineering postmortems (the :id is an incident TASK) ───────────
    {
        method: "get",
        route: "/api/v1/eng/incidents/:id/postmortem",
        url: (b) => `/api/v1/eng/incidents/${b.taskId}/postmortem`,
    },
    {
        method: "post",
        route: "/api/v1/eng/incidents/:id/postmortem",
        url: (b) => `/api/v1/eng/incidents/${b.taskId}/postmortem`,
        body: () => ({ items: { "Timeline written": true } }),
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

    // ── P5: everything that hangs off a task in the collaboration surface ───
    // Seeded directly, like the rows above: the point is that A cannot reach
    // B's ids, and going through B's API to create them would only test that
    // B can use their own workspace.
    const notificationId = fakeId("ntf");
    await db.insert(notifications).values({
        id: notificationId,
        userId: owner.id,
        type: "assigned",
        entityType: "task",
        entityId: task.id,
        actorId: second.id,
        title: "Neighbour was assigned a task",
    });

    const attachmentId = fakeId("att");
    await db.insert(attachments).values({
        id: attachmentId,
        taskId: task.id,
        name: "neighbour-invoice.pdf",
        storageKey: `ws/${ws.id}/tasks/${task.id}/neighbour-invoice.pdf`,
        mimeType: "application/pdf",
        sizeBytes: BigInt(2048),
        uploadedBy: owner.id,
        uploadStatus: "complete",
    });

    const assignmentRequestId = fakeId("areq");
    await db.insert(taskAssignmentRequests).values({
        id: assignmentRequestId,
        workspaceId: ws.id,
        spaceId: space.id,
        taskId: task.id,
        targetUserId: second.id,
        requestedBy: owner.id,
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    const commentId = fakeId("cmt");
    await db.insert(comments).values({
        id: commentId,
        taskId: task.id,
        parentCommentId: null,
        authorId: owner.id,
        body: "Neighbour's private thread",
    });

    const checklistId = fakeId("chk");
    await db.insert(checklists).values({
        id: checklistId,
        taskId: task.id,
        name: "Neighbour checklist",
        position: 0,
    });

    const checklistItemId = fakeId("cki");
    await db.insert(checklistItems).values({
        id: checklistItemId,
        checklistId,
        parentItemId: null,
        text: "Neighbour step",
        position: 0,
    });

    // ── P6: the read models. A weekly report, a public form with a field,
    // and a sprint — the four things P6's `:id` routes address.
    const reportId = fakeId("rpt");
    await db.insert(departmentReports).values({
        id: reportId,
        workspaceId: ws.id,
        spaceId: space.id,
        weekStart: "2026-08-24",
        weekEnd: "2026-08-30",
        headUserId: owner.id,
        payload: { completed: 3 },
        generatedBy: owner.id,
        generatedAt: new Date(),
    });

    const formId = fakeId("frm");
    await db.insert(forms).values({
        id: formId,
        listId: list.id,
        title: "Neighbour intake",
        isPublic: true,
        publicSlug: `neighbour-${fakeId("s").slice(-8)}`,
        createdBy: owner.id,
    });
    const formFieldId = fakeId("ffld");
    await db.insert(formFields).values({
        id: formFieldId,
        formId,
        fieldKind: "task_attr",
        fieldKey: "name",
        label: "Your name",
        position: 0,
    });

    const sprintId = (
        await makeSprint({
            workspaceId: ws.id,
            name: "Neighbour sprint 1",
            startDate: "2026-08-24",
            endDate: "2026-09-06",
            status: "planned",
        })
    ).id;

    // `makeWorkspace` seeds the four system roles, which is what a real
    // deployment looks like — so B always has a role id to probe.
    const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.workspaceId, ws.id))
        .limit(1);

    // P7: B's own role assignment, so `DELETE /users/:id/roles/:assignmentId`
    // has a real id to be refused rather than a fabricated one (which would
    // 404 for the boring reason instead of the interesting one).
    const roleAssignmentId = fakeId("ura");
    await db.insert(userRoleGrants).values({
        id: roleAssignmentId,
        workspaceId: ws.id,
        userId: second.id,
        roleId: role.id,
        scopeType: "workspace",
        scopeId: null,
        grantedBy: owner.id,
    });

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
        notificationId,
        attachmentId,
        assignmentRequestId,
        commentId,
        checklistId,
        checklistItemId,
        reportId,
        formId,
        formFieldId,
        sprintId,
        roleAssignmentId,
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
    /** P5: a checklist of my own, so a foreign id has somewhere to be smuggled to. */
    checklistId: string;
    checklistItemId: string;
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
        const myChecklistId = fakeId("chk");
        await getDb().insert(checklists).values({
            id: myChecklistId,
            taskId: task.id,
            name: "My checklist",
            position: 0,
        });
        const myChecklistItemId = fakeId("cki");
        await getDb().insert(checklistItems).values({
            id: myChecklistItemId,
            checklistId: myChecklistId,
            parentItemId: null,
            text: "My step",
            position: 0,
        });

        mine = {
            workspaceId: ws.id,
            userId: owner.id,
            spaceId: space.id,
            listId: list.id,
            statusId: status.id,
            taskTypeId: taskType.id,
            taskId: task.id,
            checklistId: myChecklistId,
            checklistItemId: myChecklistItemId,
        };

        foreign = await buildForeign();
    });

    it("has a probe for every covered endpoint that takes an id", () => {
        // Read from the live route table rather than a copy, so adding a route
        // with an `:id` and no probe fails HERE, naming it — instead of the new
        // endpoint quietly never being asked the question.
        const needed = allEndpoints()
            .filter(
                (e) =>
                    PHASES_COVERED.includes(e.phase) &&
                    e.path.includes("/:") &&
                    !NOT_AN_ID_PROBE.has(`${e.method} ${e.path}`),
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

            // ── P5: the collaboration surface ───────────────────────────────
            // Each of these is a write the caller IS allowed to make, carrying
            // one id they are not allowed to name. Replying to a neighbour's
            // comment from my own task is the sharpest: it would splice my
            // thread onto theirs, and neither side asked for it.
            {
                label: "POST /tasks/:id/comments replying to THEIR comment from MY task",
                expected: 422,
                run: (mine, theirs) =>
                    client.post(`/api/v1/tasks/${mine.taskId}/comments`).send({
                        body: "smuggled reply",
                        parent_comment_id: theirs.commentId,
                    }),
            },
            {
                label: "POST /checklists/:id/items assigning THEIR user to MY item",
                expected: 422,
                run: (mine, theirs) =>
                    client
                        .post(`/api/v1/checklists/${mine.checklistId}/items`)
                        .send({ text: "smuggled", assignee_id: theirs.userId }),
            },
            {
                label: "POST /checklists/:id/items nesting under THEIR item",
                expected: 422,
                run: (mine, theirs) =>
                    client
                        .post(`/api/v1/checklists/${mine.checklistId}/items`)
                        .send({
                            text: "smuggled",
                            parent_item_id: theirs.checklistItemId,
                        }),
            },
            {
                label: "PATCH /checklist-items/:id assigning THEIR user to MY item",
                expected: 422,
                run: (mine, theirs) =>
                    client
                        .patch(
                            `/api/v1/checklist-items/${mine.checklistItemId}`,
                        )
                        .send({ assignee_id: theirs.userId }),
            },

            // ── P6 ──────────────────────────────────────────────────────────
            {
                label: "POST /sprints/:id/tasks pulling THEIR task into MY sprint",
                expected: 404,
                run: async (mine, theirs) => {
                    const created = await client
                        .post("/api/v1/sprints")
                        .send({
                            name: "My sprint",
                            start_date: "2026-08-24",
                            end_date: "2026-09-06",
                        });
                    expect(created.status).toBe(201);
                    return client
                        .post(`/api/v1/sprints/${created.body.id}/tasks`)
                        .send({ task_ids: [theirs.taskId] });
                },
            },
            {
                label: "POST /forms into THEIR list",
                expected: 404,
                run: (mine, theirs) =>
                    client.post("/api/v1/forms").send({
                        list_id: theirs.listId,
                        title: "Smuggled form",
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

        /**
         * The two P6 routes the URL sweep cannot ask about, asked properly.
         *
         * Neither takes an id a neighbour owns — one is deliberately public,
         * the other is keyed by a calendar date every workspace shares — so
         * the question is not "is it refused?" but "does it stay inside its own
         * tenant?". See `NOT_AN_ID_PROBE` for why they are excluded above.
         */
        it("writing MY on-call week leaves the neighbour's week untouched", async () => {
            const week = "2026-08-24";
            const theirEngineer = foreign.userId;

            const before = await getDb()
                .select({ id: onCallShifts.id })
                .from(onCallShifts)
                .where(eq(onCallShifts.workspaceId, foreign.workspaceId));

            const mineWrite = await client
                .put(`/api/v1/on-call/${week}`)
                .send({ engineer_id: mine.userId });
            expect(mineWrite.status).toBeLessThan(300);

            // Their engineer cannot be named from my workspace…
            const theirs = await client
                .put(`/api/v1/on-call/${week}`)
                .send({ engineer_id: theirEngineer });
            expect(theirs.status).toBeGreaterThanOrEqual(400);

            // …and their schedule for that same week is exactly as it was.
            const after = await getDb()
                .select({ id: onCallShifts.id })
                .from(onCallShifts)
                .where(eq(onCallShifts.workspaceId, foreign.workspaceId));
            expect(after).toEqual(before);
        });

        it("a public submit lands in the FORM's workspace, never the caller's", async () => {
            // The slug is a capability: anyone holding it may submit, including
            // somebody signed into another workspace. What must hold is that the
            // resulting task belongs to the form's tenant.
            const [form] = await getDb()
                .select({ slug: forms.publicSlug })
                .from(forms)
                .where(eq(forms.id, foreign.formId));

            const res = await client
                .post(`/api/v1/public/forms/${form.slug}/submit`)
                .send({ data: { name: "Outsider" } });

            // Whether it succeeds is the form's own business (it may lack a
            // default task type); what matters is that nothing landed in MY
            // workspace.
            if (res.status === 201) {
                const [task] = await getDb()
                    .select({ workspaceId: tasks.workspaceId })
                    .from(tasks)
                    .where(eq(tasks.id, res.body.task_id));
                expect(task.workspaceId).toBe(foreign.workspaceId);
                expect(task.workspaceId).not.toBe(mine.workspaceId);
            } else {
                expect(res.status).toBeGreaterThanOrEqual(400);
            }
        });
    });

    it.each(PROBES.map((p) => [`${p.method.toUpperCase()} ${p.route}`, p] as const))(
        "%s → refused",
        async (_label, probe) => {
            let req = client[probe.method](probe.url(foreign));
            for (const [k, v] of Object.entries(probe.headers ?? {})) {
                req = req.set(k, v);
            }
            // supertest types `send` as string | object; the reorder endpoint's
            // body is an array and the upload's is a Buffer, both of which ARE
            // objects at runtime.
            const res = probe.body
                ? await req.send(probe.body(foreign) as object)
                : await req;

            // 404 is the rule: a 403 tells the caller the row exists, which is
            // one bit more than a stranger should get. The exceptions are
            // NAMED, not tolerated — see EXPECTED_STATUS.
            const want = EXPECTED_STATUS[`${probe.method} ${probe.route}`] ?? 404;
            expect({
                endpoint: `${probe.method.toUpperCase()} ${probe.route}`,
                status: res.status,
            }).toEqual({
                endpoint: `${probe.method.toUpperCase()} ${probe.route}`,
                status: want,
            });
        },
    );
});
