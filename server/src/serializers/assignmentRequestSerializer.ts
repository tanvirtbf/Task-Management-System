import type {
    AssignmentRequestEventRow,
    RequestTaskSnapshot,
} from "../repositories/AssignmentRequestsRepo";
import type { RequestDetail } from "../services/AssignmentRequestsService";
import { toWireUser, type WireUser } from "./userSerializer";

/**
 * Assignment-approval wire shapes (team-access P8) — snake_case throughout.
 *
 * `task` is the server-hydrated SNAPSHOT (title, team, list, due date) — NOT
 * the caller-scoped task read. The receiver of a request is, by definition,
 * outside the task's team boundary; this is the deliberate, narrow window
 * through which they see what they are consenting to. Users are hydrated the
 * activity-feed way (`WireUser | null` — null for a since-removed account or
 * the system janitor).
 */

export interface WireAssignmentRequestEvent {
    id: string;
    action:
        | "created"
        | "accepted"
        | "declined"
        | "queried"
        | "answered"
        | "cancelled"
        | "expired";
    actor: WireUser | null;
    note: string | null;
    proposed_due_date: string | null;
    created_at: string;
}

export interface WireAssignmentRequestTask {
    id: string;
    name: string;
    custom_id: string | null;
    list_id: string;
    list_name: string;
    space_id: string;
    space_name: string;
    due_date: string | null;
    priority: number;
    archived: boolean;
}

export interface WireAssignmentRequest {
    id: string;
    status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
    task: WireAssignmentRequestTask | null;
    target_user: WireUser | null;
    requested_by: WireUser | null;
    decided_by: WireUser | null;
    request_note: string | null;
    query_note: string | null;
    proposed_due_date: string | null;
    decided_at: string | null;
    expires_at: string;
    created_at: string;
    updated_at: string;
    events: WireAssignmentRequestEvent[];
}

const ymdOf = (d: Date | null): string | null =>
    d ? d.toISOString().slice(0, 10) : null;

const toWireTaskSnapshot = (
    t: RequestTaskSnapshot,
): WireAssignmentRequestTask => ({
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

const toWireEvent = (
    e: AssignmentRequestEventRow,
    user: WireUser | null,
): WireAssignmentRequestEvent => ({
    id: e.id,
    action: e.action,
    actor: user,
    note: e.note,
    proposed_due_date: e.proposedDueDate ?? null,
    created_at: e.createdAt.toISOString(),
});

export const toWireAssignmentRequest = (
    d: RequestDetail,
): WireAssignmentRequest => {
    const wireUserOf = (id: string | null): WireUser | null => {
        if (!id) return null;
        const u = d.usersById.get(id);
        return u ? toWireUser(u) : null;
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
