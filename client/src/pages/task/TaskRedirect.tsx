import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { tasksApi } from "../../http/api";
import { useListMap } from "../../hooks/useReferenceData";
import { tokens } from "../../theme";

/**
 * /t/:taskKey → resolves the task, then redirects to its list with
 * ?task= query param so the detail drawer opens overlaid on the list.
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

    useEffect(() => {
        if (!task) return;
        const list = listMap.get(task.primaryListId);
        if (list) {
            navigate(`/s/${list.spaceId}/l/${list.id}?task=${task.id}`, {
                replace: true,
            });
        } else {
            navigate("/", { replace: true });
        }
    }, [task, navigate, listMap]);

    return (
        <div
            style={{
                padding: tokens.spacing[8],
                textAlign: "center",
                color: tokens.colors.textMuted,
            }}
        >
            {isError ? "Task not found" : "Opening task..."}
        </div>
    );
};

export default TaskRedirect;
