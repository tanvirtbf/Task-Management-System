import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Modal,
    Select,
    Input,
    App as AntApp,
    Alert,
} from "antd";
import { mockApi } from "../../lib/mock-api";
import { lists as allLists } from "../../mocks/lists";
import { spaces as allSpaces, spacesById } from "../../mocks/spaces";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { tokens } from "../../theme";
import type { Template } from "../../types/template";

interface Props {
    template: Template;
    onClose: () => void;
}

export const TemplateApplyModal = ({ template, onClose }: Props) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [targetListId, setTargetListId] = useState<string | undefined>();
    const [targetSpaceId, setTargetSpaceId] = useState<string | undefined>();
    const [taskName, setTaskName] = useState("");

    const requiresList = template.type === "task" || template.type === "form";
    const requiresSpace = template.type === "list" || template.type === "folder";

    const apply = useMutation({
        mutationFn: () =>
            mockApi.templates.apply(template.id, {
                listId: targetListId,
                spaceId: targetSpaceId,
                taskName: taskName || undefined,
            }),
        onSuccess: (result) => {
            qc.invalidateQueries({ queryKey: ["templates"] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
            qc.invalidateQueries({ queryKey: ["lists"] });
            message.success(result.message ?? "Template applied");
            onClose();
        },
    });

    const canApply =
        (!requiresList || !!targetListId) &&
        (!requiresSpace || !!targetSpaceId);

    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => apply.mutate()}
            okText="Apply template"
            okButtonProps={{
                disabled: !canApply,
                loading: apply.isPending,
            }}
            width={520}
            title={null}
        >
            {/* Header */}
            <div
                style={{
                    display: "flex",
                    gap: 12,
                    padding: "8px 0 16px",
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                    marginBottom: 16,
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: tokens.radius.md,
                        background: `${template.color}1A`,
                        color: template.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}
                >
                    <DynamicIcon
                        name={template.icon}
                        size={22}
                        strokeWidth={1.75}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h3
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize.lg,
                            fontWeight: 700,
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        Apply “{template.name}”
                    </h3>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textMuted,
                        }}
                    >
                        {template.description}
                    </p>
                </div>
            </div>

            {/* Target picker */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                {requiresList && (
                    <Field label="Target list">
                        <Select
                            value={targetListId}
                            onChange={setTargetListId}
                            placeholder="Pick a list..."
                            style={{ width: "100%" }}
                            showSearch
                            optionFilterProp="label"
                            options={allLists.map((l) => {
                                const sp = spacesById.get(l.spaceId);
                                return {
                                    value: l.id,
                                    label: `${sp?.name} / ${l.name}`,
                                };
                            })}
                        />
                    </Field>
                )}

                {requiresSpace && (
                    <Field label="Target space">
                        <Select
                            value={targetSpaceId}
                            onChange={setTargetSpaceId}
                            placeholder="Pick a space..."
                            style={{ width: "100%" }}
                            options={allSpaces.map((s) => ({
                                value: s.id,
                                label: s.name,
                            }))}
                        />
                    </Field>
                )}

                {template.type === "task" && (
                    <Field label="Task name (optional)">
                        <Input
                            value={taskName}
                            onChange={(e) => setTaskName(e.target.value)}
                            placeholder={template.name}
                        />
                    </Field>
                )}

                {template.type === "checklist" && (
                    <Alert
                        message="Use this checklist on an existing task"
                        description="Open any task and select 'Apply checklist template' to use this template."
                        type="info"
                        showIcon
                    />
                )}

                {template.type === "view" && (
                    <Alert
                        message="Saved view filter"
                        description="This template creates a saved view filter on the target list."
                        type="info"
                        showIcon
                    />
                )}
            </div>

            <div
                style={{
                    marginTop: 16,
                    padding: 10,
                    background: tokens.colors.bgMuted,
                    borderRadius: tokens.radius.md,
                    fontSize: 12,
                    color: tokens.colors.textSecondary,
                    fontFamily: tokens.typography.fontFamilyMono,
                    lineHeight: 1.5,
                }}
            >
                Type:{" "}
                <strong style={{ color: tokens.colors.textPrimary }}>
                    {template.type}
                </strong>{" "}
                · Sharing:{" "}
                <strong style={{ color: tokens.colors.textPrimary }}>
                    {template.sharing}
                </strong>{" "}
                · Used{" "}
                <strong style={{ color: tokens.colors.textPrimary }}>
                    {template.usageCount}×
                </strong>
            </div>
        </Modal>
    );
};

const Field = ({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) => (
    <div>
        <label
            style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: tokens.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 4,
            }}
        >
            {label}
        </label>
        {children}
    </div>
);
