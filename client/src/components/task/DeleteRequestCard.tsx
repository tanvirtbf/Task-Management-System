import { Button, Modal, App as AntApp } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { deleteRequestsApi, type DeleteRequest } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { useUserMap } from "../../hooks/useReferenceData";
import { usePermissions } from "../../hooks/usePermissions";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

/**
 * One pending permanent-delete request (upgrades/023) — rendered in
 * Inbox → Requests beside the assignment approvals, because that tab is where
 * a person goes to answer things.
 *
 * The card shows the same three facts the decision needs: WHAT would be
 * destroyed, WHO asked, and WHY. Approving is behind a confirm — this is the
 * one action in the app that cannot be undone.
 */
export const DeleteRequestCard = ({ request }: { request: DeleteRequest }) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const { holds } = usePermissions();
    const userMap = useUserMap();
    const myId = useAuthStore((s) => s.user?.id);

    const invalidate = () => {
        qc.invalidateQueries({ queryKey: ["delete-requests"] });
        qc.invalidateQueries({ queryKey: ["delete-request", request.taskId] });
        qc.invalidateQueries({ queryKey: ["task", request.taskId] });
        qc.invalidateQueries({ queryKey: ["tasks-by-list"] });
    };

    const decide = useMutation({
        mutationFn: (approve: boolean) =>
            approve
                ? deleteRequestsApi.approve(request.id)
                : deleteRequestsApi.reject(request.id),
        onSuccess: (_r, approve) => {
            message.success(
                approve ? "Task permanently deleted" : "Request rejected",
            );
            invalidate();
        },
        onError: (err) => message.error(getApiErrorMessage(err)),
    });

    const cancel = useMutation({
        mutationFn: () => deleteRequestsApi.cancel(request.id),
        onSuccess: () => {
            message.success("Request withdrawn");
            invalidate();
        },
        onError: (err) => message.error(getApiErrorMessage(err)),
    });

    const asker = userMap.get(request.requestedBy);
    const askerName = asker
        ? `${asker.firstName} ${asker.lastName}`.trim()
        : "Someone";

    return (
        <div
            style={{
                border: `1px solid ${tokens.colors.danger}`,
                borderRadius: tokens.radius.md,
                background: tokens.colors.dangerSubtle,
                padding: tokens.spacing[4],
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: tokens.colors.danger,
                    fontWeight: 600,
                }}
            >
                <Trash2 size={13} strokeWidth={2} />
                Permanent delete requested
            </div>

            <div style={{ marginTop: 6, fontSize: 13 }}>
                <Link to={`/t/${request.taskId}`} style={{ fontWeight: 600 }}>
                    {request.taskName}
                </Link>
                <span style={{ color: tokens.colors.textMuted }}>
                    {" "}
                    — asked by {askerName}
                </span>
            </div>

            {request.reason && (
                <div
                    style={{
                        marginTop: 4,
                        fontSize: 12,
                        fontStyle: "italic",
                        color: tokens.colors.textSecondary,
                    }}
                >
                    “{request.reason}”
                </div>
            )}

            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                {holds("task.delete_hard") && (
                    <>
                        <Button
                            size="small"
                            danger
                            loading={decide.isPending}
                            onClick={() =>
                                Modal.confirm({
                                    title: "Delete this task permanently?",
                                    content:
                                        "This cannot be undone. Its comments, checklists and attachments go with it.",
                                    okText: "Delete permanently",
                                    okButtonProps: { danger: true },
                                    onOk: () => decide.mutateAsync(true),
                                })
                            }
                        >
                            Approve
                        </Button>
                        <Button
                            size="small"
                            loading={decide.isPending}
                            onClick={() => decide.mutate(false)}
                        >
                            Reject
                        </Button>
                    </>
                )}
                {request.requestedBy === myId && (
                    <Button
                        size="small"
                        loading={cancel.isPending}
                        onClick={() => cancel.mutate()}
                    >
                        Withdraw
                    </Button>
                )}
            </div>
        </div>
    );
};
