import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton, App as AntApp } from "antd";
import type { Task } from "../../types";
import { customFieldsApi, tasksApi } from "../../http/api";
import { CustomFieldRenderer } from "./CustomFieldRenderer";
import { tokens } from "../../theme";

/**
 * Renders all custom fields for a task in a vertical stack.
 * Used inside TaskDetailDrawer below the standard properties panel.
 */
export const CustomFieldsList = ({ task }: { task: Task }) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();

    const { data: fields = [], isLoading } = useQuery({
        queryKey: ["custom-fields-by-list", task.primaryListId],
        queryFn: () => customFieldsApi.byList(task.primaryListId),
    });

    // §17 values: PUT the typed envelope (returns the full Task) or DELETE to
    // clear (a renderer emits `null` to clear). PATCH does NOT carry these.
    const setValue = useMutation({
        mutationFn: async ({
            fieldId,
            value,
        }: {
            fieldId: string;
            value: unknown;
        }) => {
            if (value == null) {
                await tasksApi.clearCustomField(task.id, fieldId);
            } else {
                await tasksApi.setCustomField(task.id, fieldId, value);
            }
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["task", task.id] }),
        onError: () => message.error("Could not update custom field"),
    });

    const handleChange = (fieldId: string, value: unknown) =>
        setValue.mutate({ fieldId, value });

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
