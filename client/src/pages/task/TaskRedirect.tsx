import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { Inbox } from "lucide-react";
import { tasksApi } from "../../http/api";
import { useListMap } from "../../hooks/useReferenceData";
import { TaskDetailDrawer } from "../../components/task/TaskDetailDrawer";
import { tokens } from "../../theme";

/**
 * /t/:taskKey → resolves the task, then redirects to its list with
 * ?task= query param so the detail drawer opens overlaid on the list.
 *
 * Team-access P9, two boundary cases this page must survive:
 *   - B5: a CROSS-TEAM ASSIGNEE can open their task but not browse its
 *     list — the list is absent from their reference data. Redirecting
 *     "home" was a dead-end; now the drawer opens right here instead.
 *   - A deep-link to a task you cannot see (a pending request's task, or
 *     one you were unassigned from) answers 404 — worded as the team
 *     boundary it usually is, with the Inbox as the next step, never a
 *     raw "not found".
 *
 * Full-page direct task view is Phase 11 polish.
 */
const TaskRedirect = () => {
    const { taskKey } = useParams();
    const navigate = useNavigate();
    const listMap = useListMap();

    const { data: task, isError } = useQuery({
        queryKey: ["task", taskKey],
        queryFn: () =>
            taskKey ? tasksApi.getById(taskKey) : Promise.resolve(null),
        enabled: !!taskKey,
        retry: false,
    });

    const mapsReady = listMap.size > 0;
    const list = task ? listMap.get(task.primaryListId) : undefined;

    useEffect(() => {
        if (!task || !list) return;
        navigate(`/s/${list.spaceId}/l/${list.id}?task=${task.id}`, {
            replace: true,
        });
    }, [task, list, navigate]);

    if (isError) {
        return (
            <div
                style={{
                    padding: tokens.spacing[8],
                    textAlign: "center",
                    color: tokens.colors.textMuted,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                }}
            >
                <div
                    style={{
                        fontSize: tokens.typography.fontSize.lg,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    You don't have access to this task
                </div>
                <div style={{ maxWidth: 420 }}>
                    It belongs to another team, or you no longer have access —
                    it may also have been deleted. If someone requested to
                    assign you, accept the request first and the task will
                    open.
                </div>
                <Button
                    icon={<Inbox size={14} strokeWidth={1.75} />}
                    onClick={() => navigate("/inbox")}
                >
                    Open Inbox
                </Button>
            </div>
        );
    }

    // B5: the task resolved but its list is outside my sight — show the task
    // itself right here instead of dead-ending on the home page.
    if (task && mapsReady && !list) {
        return (
            <TaskDetailDrawer
                taskId={task.id}
                listId={task.primaryListId}
                onClose={() => navigate("/", { replace: true })}
            />
        );
    }

    return (
        <div
            style={{
                padding: tokens.spacing[8],
                textAlign: "center",
                color: tokens.colors.textMuted,
            }}
        >
            Opening task...
        </div>
    );
};

export default TaskRedirect;
