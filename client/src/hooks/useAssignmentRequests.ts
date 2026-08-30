import { useCallback } from "react";
import {
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { assignmentRequestsApi, teamsApi } from "../http/api";
import { getApiErrorMessage } from "../http/client";
import { useAuthStore } from "../stores/auth";
import type { AssignmentRequest } from "../types";

/**
 * Cross-team assignment approval — the client half (team-access P9).
 *
 * One shared hook family so the drawer panel and the Inbox "Requests" tab
 * behave identically: the same queries, the same mutations, the same
 * invalidation set, the same error surfacing. The SERVER stays the authority
 * on who may act — these hooks only decide which buttons are worth showing,
 * and a refused click still surfaces the server's human message.
 */

/** Everything the approval flow can go stale on after ANY action. */
const invalidateApprovalWorld = (
    qc: ReturnType<typeof useQueryClient>,
): void => {
    void qc.invalidateQueries({ queryKey: ["assignment-requests"] });
    void qc.invalidateQueries({ queryKey: ["task"] });
    void qc.invalidateQueries({ queryKey: ["tasks-by-list"] });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    void qc.invalidateQueries({ queryKey: ["my-work"] });
};

/** The task's negotiation history (drawer panel). */
export const useTaskAssignmentRequests = (taskId: string | null) =>
    useQuery({
        queryKey: ["assignment-requests", "task", taskId],
        queryFn: () =>
            taskId
                ? assignmentRequestsApi.listForTask(taskId)
                : Promise.resolve([]),
        enabled: !!taskId,
    });

/** One box of MY requests (inbox tab). */
export const useMyAssignmentRequests = (
    box: "received" | "sent" | "team",
    status: "pending" | "all" = "pending",
) =>
    useQuery({
        queryKey: ["assignment-requests", "mine", box, status],
        queryFn: () => assignmentRequestsApi.list(box, status),
    });

/**
 * May I decide THIS request? Mirrors the server rule (Q2/B6): the target,
 * any Head of a team the target belongs to, or an admin — never the
 * requester. The teams directory (cached under ["teams"]) supplies the
 * head-of-target's-team half.
 */
export const useCanDecideRequest = (): ((
    r: AssignmentRequest,
) => boolean) => {
    const me = useAuthStore((s) => s.user);
    const { data: directory } = useQuery({
        queryKey: ["teams"],
        queryFn: teamsApi.directory,
        staleTime: 60_000,
    });
    return useCallback(
        (r: AssignmentRequest): boolean => {
            if (!me || r.status !== "pending") return false;
            if (r.requestedBy?.id === me.id && r.targetUser?.id !== me.id) {
                return false; // asking is not consenting — admin or not
            }
            if (r.targetUser?.id === me.id) return true;
            if (me.role === "owner" || me.role === "admin") return true;
            const teams = directory?.teams ?? [];
            return teams.some(
                (t) =>
                    t.space.headUserId === me.id &&
                    t.members.some(
                        (m) => m.user.id === r.targetUser?.id,
                    ),
            );
        },
        [me, directory],
    );
};

/** All five actions with the shared invalidation + error toasts. */
export const useAssignmentRequestActions = () => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();

    const useAction = <TArgs extends unknown[]>(
        fn: (...args: TArgs) => Promise<AssignmentRequest>,
        okText: string,
    ) =>
        useMutation({
            mutationFn: (args: TArgs) => fn(...args),
            onSuccess: () => {
                invalidateApprovalWorld(qc);
                message.success(okText);
            },
            onError: (err) => message.error(getApiErrorMessage(err)),
        });

     
    const accept = useAction(
        (id: string, note?: string) => assignmentRequestsApi.accept(id, note),
        "Assignment accepted",
    );
    const decline = useAction(
        (id: string, note?: string) =>
            assignmentRequestsApi.decline(id, note),
        "Request declined",
    );
    const query = useAction(
        (id: string, note: string, proposedDueDate?: string | null) =>
            assignmentRequestsApi.query(id, note, proposedDueDate),
        "Query sent to the requester",
    );
    const answer = useAction(
        (id: string, input: { note?: string; dueDate?: string }) =>
            assignmentRequestsApi.answer(id, input),
        "Reply sent",
    );
    const cancel = useAction(
        (id: string) => assignmentRequestsApi.cancel(id),
        "Request withdrawn",
    );
     

    return { accept, decline, query, answer, cancel };
};
