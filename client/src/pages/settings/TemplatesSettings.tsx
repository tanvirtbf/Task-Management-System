import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, App as AntApp, Modal, Input, Select, Popconfirm } from "antd";
import { LayoutTemplate, Plus, Trash2, Edit3 } from "lucide-react";
import { templatesApi } from "../../http/api";
import { useTaskTypes } from "../../hooks/useReferenceData";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { tokens } from "../../theme";
import type { Template, TemplateChecklistItem } from "../../types/template";

const TemplatesSettings = () => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [editing, setEditing] = useState<Template | null>(null);
    const [creating, setCreating] = useState(false);

    const { data: templates = [], isLoading } = useQuery({
        queryKey: ["templates", "all"],
        queryFn: () => templatesApi.list(),
    });

    return (
        <div style={{ padding: tokens.spacing[6], maxWidth: 1000 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: tokens.spacing[5],
                }}
            >
                <div>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["2xl"],
                            fontWeight: 700,
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        Templates
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 4,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        Reusable task templates with pre-built checklists. Apply
                        from any campaign list via the "Apply template" button.
                    </p>
                </div>
                <Button
                    type="primary"
                    icon={<Plus size={14} strokeWidth={2} />}
                    onClick={() => setCreating(true)}
                >
                    New template
                </Button>
            </div>

            {isLoading ? (
                <div style={{ color: tokens.colors.textMuted }}>Loading…</div>
            ) : templates.length === 0 ? (
                <EmptyState onCreate={() => setCreating(true)} />
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                        gap: tokens.spacing[4],
                    }}
                >
                    {templates.map((tpl) => (
                        <TemplateCard
                            key={tpl.id}
                            template={tpl}
                            onEdit={() => setEditing(tpl)}
                            onDelete={async () => {
                                await templatesApi.delete(tpl.id);
                                message.success(
                                    `Template "${tpl.name}" deleted`,
                                );
                                qc.invalidateQueries({
                                    queryKey: ["templates", "all"],
                                });
                            }}
                        />
                    ))}
                </div>
            )}

            <TemplateEditor
                open={creating || !!editing}
                template={editing}
                onClose={() => {
                    setCreating(false);
                    setEditing(null);
                }}
                onSaved={() => {
                    setCreating(false);
                    setEditing(null);
                    qc.invalidateQueries({ queryKey: ["templates", "all"] });
                    message.success("Template saved");
                }}
            />
        </div>
    );
};

const TemplateCard = ({
    template,
    onEdit,
    onDelete,
}: {
    template: Template;
    onEdit: () => void;
    onDelete: () => void;
}) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[4],
            display: "flex",
            flexDirection: "column",
            gap: tokens.spacing[3],
        }}
    >
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.spacing[2],
            }}
        >
            <div
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: tokens.radius.md,
                    background: `${template.color ?? "#94A3B8"}1A`,
                    color: template.color ?? "#94A3B8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <DynamicIcon
                    name={template.icon ?? "LayoutTemplate"}
                    size={16}
                    strokeWidth={1.75}
                />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        fontWeight: 600,
                        fontSize: tokens.typography.fontSize.base,
                        color: tokens.colors.textPrimary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {template.name}
                </div>
                <div
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                    }}
                >
                    {template.structure.checklistItems?.length ?? 0} steps · used{" "}
                    {template.usageCount} times
                </div>
            </div>
        </div>

        {template.description && (
            <p
                style={{
                    margin: 0,
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textSecondary,
                    lineHeight: 1.4,
                }}
            >
                {template.description}
            </p>
        )}

        <div
            style={{
                display: "flex",
                gap: 6,
                paddingTop: tokens.spacing[2],
                borderTop: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <Button
                size="small"
                icon={<Edit3 size={12} strokeWidth={1.75} />}
                onClick={onEdit}
            >
                Edit
            </Button>
            <Popconfirm
                title="Delete this template?"
                description="Existing tasks won't be affected."
                onConfirm={onDelete}
            >
                <Button
                    size="small"
                    danger
                    icon={<Trash2 size={12} strokeWidth={1.75} />}
                >
                    Delete
                </Button>
            </Popconfirm>
        </div>
    </div>
);

const TemplateEditor = ({
    open,
    template,
    onClose,
    onSaved,
}: {
    open: boolean;
    template: Template | null;
    onClose: () => void;
    onSaved: () => void;
}) => {
    const { message } = AntApp.useApp();
    const { data: taskTypes = [] } = useTaskTypes();
    const [name, setName] = useState(template?.name ?? "");
    const [description, setDescription] = useState(template?.description ?? "");
    const [taskTypeId, setTaskTypeId] = useState(
        template?.structure.taskTypeId ?? "",
    );
    const [items, setItems] = useState<TemplateChecklistItem[]>(
        template?.structure.checklistItems ?? [{ text: "" }],
    );

    const save = useMutation({
        mutationFn: () => {
            const structure = {
                ...(taskTypeId ? { taskTypeId } : {}),
                checklistItems: items.filter((it) => it.text.trim()),
            };
            const body = {
                name: name.trim(),
                description: description.trim() || undefined,
                structure,
            };
            return template
                ? templatesApi.update(template.id, body)
                : templatesApi.create({ type: "task", ...body });
        },
        onSuccess: onSaved,
        onError: () => message.error("Failed to save template"),
    });

    return (
        <Modal
            title={template ? "Edit template" : "New template"}
            open={open}
            onCancel={onClose}
            onOk={() => save.mutate()}
            okText={template ? "Save" : "Create"}
            okButtonProps={{
                disabled: !name.trim(),
                loading: save.isPending,
            }}
            width={640}
            destroyOnClose
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: tokens.spacing[3],
                    paddingTop: tokens.spacing[2],
                }}
            >
                <div>
                    <Label>Name</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g., Eid Campaign 12-step playbook"
                    />
                </div>

                <div>
                    <Label>Description</Label>
                    <Input.TextArea
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="What this template is for"
                    />
                </div>

                <div>
                    <Label>Task type</Label>
                    <Select
                        value={taskTypeId || undefined}
                        onChange={setTaskTypeId}
                        style={{ width: "100%" }}
                        placeholder="Select a task type"
                        options={taskTypes.map((tt) => ({
                            value: tt.id,
                            label: tt.name,
                        }))}
                    />
                </div>

                <div>
                    <Label>Checklist items</Label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {items.map((item, i) => (
                            <div
                                key={i}
                                style={{ display: "flex", gap: 6 }}
                            >
                                <Input
                                    value={item.text}
                                    placeholder={`Step ${i + 1}`}
                                    onChange={(e) => {
                                        const next = [...items];
                                        next[i] = { ...item, text: e.target.value };
                                        setItems(next);
                                    }}
                                />
                                <Button
                                    danger
                                    type="text"
                                    icon={<Trash2 size={14} strokeWidth={1.75} />}
                                    onClick={() =>
                                        setItems(items.filter((_, j) => j !== i))
                                    }
                                />
                            </div>
                        ))}
                        <Button
                            size="small"
                            icon={<Plus size={12} strokeWidth={2} />}
                            onClick={() =>
                                setItems([...items, { text: "" }])
                            }
                        >
                            Add step
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

const EmptyState = ({ onCreate }: { onCreate: () => void }) => (
    <div
        style={{
            padding: tokens.spacing[10],
            textAlign: "center",
            background: tokens.colors.bgSurface,
            border: `1px dashed ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
        }}
    >
        <LayoutTemplate
            size={32}
            strokeWidth={1.5}
            color={tokens.colors.textMuted}
        />
        <h3
            style={{
                margin: `${tokens.spacing[3]}px 0 ${tokens.spacing[2]}px`,
                color: tokens.colors.textPrimary,
            }}
        >
            No templates yet
        </h3>
        <p
            style={{
                margin: 0,
                marginBottom: tokens.spacing[4],
                color: tokens.colors.textMuted,
                fontSize: tokens.typography.fontSize.sm,
            }}
        >
            Build reusable templates for recurring workflows like campaigns, product
            launches and incident responses.
        </p>
        <Button
            type="primary"
            icon={<Plus size={14} strokeWidth={2} />}
            onClick={onCreate}
        >
            Create your first template
        </Button>
    </div>
);

const Label = ({ children }: { children: React.ReactNode }) => (
    <div
        style={{
            fontSize: 11,
            fontWeight: 600,
            color: tokens.colors.textMuted,
            marginBottom: 4,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
        }}
    >
        {children}
    </div>
);

export default TemplatesSettings;
