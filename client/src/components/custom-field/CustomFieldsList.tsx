import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "antd";
import type { Task } from "../../types";
import { mockApi } from "../../lib/mock-api";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { CustomFieldRenderer } from "./CustomFieldRenderer";
import { tokens } from "../../theme";

/**
 * Renders all custom fields for a task in a vertical stack.
 * Used inside TaskDetailDrawer below the standard properties panel.
 */
export const CustomFieldsList = ({ task }: { task: Task }) => {
    const { data: fields = [], isLoading } = useQuery({
        queryKey: ["custom-fields-by-list", task.primaryListId],
        queryFn: () => mockApi.customFields.byList(task.primaryListId),
    });
    const qc = useQueryClient();
    const update = useUpdateTask(task.primaryListId);

    const handleChange = (fieldId: string, value: unknown) => {
        const next = { ...task.customFields, [fieldId]: value };
        update.mutate(
            { id: task.id, patch: { customFields: next } },
            {
                onSuccess: () =>
                    qc.invalidateQueries({ queryKey: ["task", task.id] }),
            },
        );
    };

    if (isLoading) return <Skeleton active paragraph={{ rows: 3 }} />;
    if (fields.length === 0) return null;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[3],
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                    marginBottom: 2,
                }}
            >
                Custom Fields
            </div>
            {fields.map((field) => (
                <div
                    key={field.id}
                    style={{
                        display: "grid",
                        gridTemplateColumns: "140px 1fr",
                        gap: tokens.spacing[3],
                        alignItems: "flex-start",
                    }}
                >
                    <label
                        style={{
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textSecondary,
                            paddingTop: 6,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                        }}
                    >
                        {field.name}
                        {field.isRequired && (
                            <span
                                style={{
                                    color: tokens.colors.danger,
                                    fontSize: 12,
                                }}
                            >
                                *
                            </span>
                        )}
                    </label>
                    <CustomFieldRenderer
                        field={field}
                        value={task.customFields?.[field.id]}
                        onChange={(v) => handleChange(field.id, v)}
                    />
                </div>
            ))}
        </div>
    );
};
