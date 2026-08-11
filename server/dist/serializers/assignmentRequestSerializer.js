"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireAssignmentRequest = void 0;
const userSerializer_1 = require("./userSerializer");
const ymdOf = (d) => d ? d.toISOString().slice(0, 10) : null;
const toWireTaskSnapshot = (t) => ({
    id: t.id,
    name: t.name,
    custom_id: t.customId,
    list_id: t.listId,
    list_name: t.listName,
    space_id: t.spaceId,
    space_name: t.spaceName,
    due_date: ymdOf(t.dueDate),
    priority: t.priority,
    archived: t.archivedAt !== null,
});
const toWireEvent = (e, user) => ({
    id: e.id,
    action: e.action,
    actor: user,
    note: e.note,
    proposed_due_date: e.proposedDueDate ?? null,
    created_at: e.createdAt.toISOString(),
});
const toWireAssignmentRequest = (d) => {
    const wireUserOf = (id) => {
        if (!id)
            return null;
        const u = d.usersById.get(id);
        return u ? (0, userSerializer_1.toWireUser)(u) : null;
    };
    return {
        id: d.request.id,
        status: d.request.status,
        task: d.task ? toWireTaskSnapshot(d.task) : null,
        target_user: wireUserOf(d.request.targetUserId),
        requested_by: wireUserOf(d.request.requestedBy),
        decided_by: wireUserOf(d.request.decidedBy),
        request_note: d.request.requestNote,
        query_note: d.request.queryNote,
        proposed_due_date: d.request.proposedDueDate ?? null,
        decided_at: d.request.decidedAt
            ? d.request.decidedAt.toISOString()
            : null,
        expires_at: d.request.expiresAt.toISOString(),
        created_at: d.request.createdAt.toISOString(),
        updated_at: d.request.updatedAt.toISOString(),
        events: d.events.map((e) => toWireEvent(e, wireUserOf(e.actorId))),
    };
};
exports.toWireAssignmentRequest = toWireAssignmentRequest;
