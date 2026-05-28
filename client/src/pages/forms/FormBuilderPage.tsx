import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
    Button,
    Input,
    Tabs,
    Switch,
    App as AntApp,
    ColorPicker,
    Tag as AntTag,
} from "antd";
import {
    ArrowLeft,
    Plus,
    Trash2,
    GripVertical,
    Eye,
    Settings,
    Palette,
    FormInput,
    ExternalLink,
    Type,
    DollarSign,
    Calendar as CalIcon,
    ChevronDown as DropdownIcon,
    Phone,
    Paperclip,
} from "lucide-react";
import {
    DndContext,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { mockApi } from "../../lib/mock-api";
import { customFieldsByList } from "../../mocks/custom-fields";
import { listsById } from "../../mocks/lists";
import type {
    CustomFieldType,
    Form,
    FormFieldDef,
} from "../../types/custom-fields";
import { CustomFieldRenderer } from "../../components/custom-field/CustomFieldRenderer";
import { tokens } from "../../theme";

const TYPE_ICONS: Record<CustomFieldType, React.ReactNode> = {
    text: <Type size={14} strokeWidth={1.75} />,
    phone: <Phone size={14} strokeWidth={1.75} />,
    money: <DollarSign size={14} strokeWidth={1.75} />,
    date: <CalIcon size={14} strokeWidth={1.75} />,
    dropdown: <DropdownIcon size={14} strokeWidth={1.75} />,
    files: <Paperclip size={14} strokeWidth={1.75} />,
};

const FormBuilderPage = () => {
    const { formId } = useParams();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabKey>("builder");

    const { data: form, isLoading } = useQuery({
        queryKey: ["form", formId],
        queryFn: () =>
            formId ? mockApi.forms.getById(formId) : Promise.resolve(null),
        enabled: !!formId,
    });

    const updateMutation = useMutation({
        mutationFn: (patch: Partial<Form>) =>
            mockApi.forms.update(formId!, patch),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["form", formId] });
        },
        onError: () => message.error("Save failed"),
    });

    const [draft, setDraft] = useState<Form | null>(null);

    useEffect(() => {
        if (form) setDraft(form);
    }, [form]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    if (isLoading || !draft || !form) {
        return (
            <div style={{ padding: tokens.spacing[8] }}>Loading form...</div>
        );
    }

    const list = listsById.get(form.listId);
    const availableCustomFields = customFieldsByList(form.listId);
    const usedFieldKeys = new Set(draft.fields.map((f) => f.fieldKey));

    const handleSave = () => {
        updateMutation.mutate({
            title: draft.title,
            description: draft.description,
            fields: draft.fields,
            branding: draft.branding,
            settings: draft.settings,
        });
        message.success("Form saved");
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        if (String(over.id) === "form-canvas") {
            const fieldKey = String(active.id).replace(/^palette:/, "");
            const isTaskAttr = fieldKey === "name" || fieldKey === "description";
            if (usedFieldKeys.has(fieldKey)) {
                message.warning("This field is already on the form");
                return;
            }
            const cf = availableCustomFields.find((c) => c.id === fieldKey);
            const newField: FormFieldDef = {
                id: `ff-${Date.now()}`,
                fieldKind: isTaskAttr ? "task_attr" : "custom_field",
                fieldKey,
                label: isTaskAttr
                    ? fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1)
                    : cf?.name ?? fieldKey,
                isRequired: false,
                isHidden: false,
                defaultValue: null,
                position: draft.fields.length,
            };
            setDraft({ ...draft, fields: [...draft.fields, newField] });
        }
    };

    const removeField = (id: string) => {
        setDraft({ ...draft, fields: draft.fields.filter((f) => f.id !== id) });
        if (selectedFieldId === id) setSelectedFieldId(null);
    };

    const updateField = (id: string, patch: Partial<FormFieldDef>) => {
        setDraft({
            ...draft,
            fields: draft.fields.map((f) =>
                f.id === id ? { ...f, ...patch } : f,
            ),
        });
    };

    const selectedField =
        selectedFieldId !== null
            ? draft.fields.find((f) => f.id === selectedFieldId)
            : null;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "calc(100vh - 48px)",
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[5]}px`,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    background: tokens.colors.bgSurface,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                }}
            >
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowLeft size={14} strokeWidth={1.75} />}
                    onClick={() => navigate("/forms")}
                >
                    Forms
                </Button>
                <div
                    style={{
                        width: 1,
                        height: 20,
                        background: tokens.colors.border,
                    }}
                />
                <Input
                    value={draft.title}
                    onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                    }
                    bordered={false}
                    style={{
                        fontWeight: 700,
                        fontSize: tokens.typography.fontSize.lg,
                        padding: 0,
                        width: 320,
                    }}
                />
                <div style={{ flex: 1 }} />
                <AntTag>
                    Submits to: <strong>{list?.name}</strong>
                </AntTag>
                <Button
                    size="small"
                    icon={<ExternalLink size={13} strokeWidth={1.75} />}
                    onClick={() =>
                        window.open(`/forms/${draft.publicSlug}`, "_blank")
                    }
                >
                    Preview
                </Button>
                <Button
                    size="small"
                    type="primary"
                    onClick={handleSave}
                    loading={updateMutation.isPending}
                >
                    Save
                </Button>
            </div>

            <Tabs
                defaultActiveKey="builder"
                style={{
                    background: tokens.colors.bgSurface,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    padding: `0 ${tokens.spacing[5]}px`,
                }}
                items={[
                    {
                        key: "builder",
                        label: (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                }}
                            >
                                <FormInput
                                    size={13}
                                    strokeWidth={1.75}
                                />
                                Builder
                            </span>
                        ),
                    },
                    {
                        key: "settings",
                        label: (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                }}
                            >
                                <Settings size={13} strokeWidth={1.75} />
                                Settings
                            </span>
                        ),
                    },
                    {
                        key: "branding",
                        label: (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                }}
                            >
                                <Palette size={13} strokeWidth={1.75} />
                                Branding
                            </span>
                        ),
                    },
                    {
                        key: "preview",
                        label: (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                }}
                            >
                                <Eye size={13} strokeWidth={1.75} />
                                Preview
                            </span>
                        ),
                    },
                ]}
                onChange={(k) => setActiveTab(k as TabKey)}
                activeKey={activeTab}
            />

            {activeTab === "builder" && (
                <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                    <div
                        style={{
                            flex: 1,
                            display: "flex",
                            minHeight: 0,
                        }}
                    >
                        {/* Left palette */}
                        <FormFieldPalette
                            availableCustomFields={availableCustomFields}
                            usedFieldKeys={usedFieldKeys}
                        />

                        {/* Center canvas */}
                        <FormCanvas
                            draft={draft}
                            selectedFieldId={selectedFieldId}
                            onSelectField={setSelectedFieldId}
                            onRemoveField={removeField}
                            onUpdateField={updateField}
                            onUpdateForm={(patch) =>
                                setDraft({ ...draft, ...patch })
                            }
                        />

                        {/* Right properties */}
                        <FormFieldProperties
                            field={selectedField}
                            onUpdate={(patch) =>
                                selectedField &&
                                updateField(selectedField.id, patch)
                            }
                        />
                    </div>
                </DndContext>
            )}

            {activeTab === "settings" && (
                <FormSettingsPanel
                    draft={draft}
                    onChange={(settings) =>
                        setDraft({ ...draft, settings: { ...draft.settings, ...settings } })
                    }
                />
            )}

            {activeTab === "branding" && (
                <FormBrandingPanel
                    draft={draft}
                    onChange={(branding) =>
                        setDraft({ ...draft, branding: { ...draft.branding, ...branding } })
                    }
                />
            )}

            {activeTab === "preview" && (
                <div
                    style={{
                        flex: 1,
                        overflow: "auto",
                        padding: tokens.spacing[6],
                        background: tokens.colors.bgPage,
                    }}
                >
                    <FormPreview draft={draft} />
                </div>
            )}
        </div>
    );
};

type TabKey = "builder" | "settings" | "branding" | "preview";

// ─── Palette ────────────────────────────────────────────
const FormFieldPalette = ({
    availableCustomFields,
    usedFieldKeys,
}: {
    availableCustomFields: Array<{ id: string; name: string; type: CustomFieldType }>;
    usedFieldKeys: Set<string>;
}) => (
    <aside
        style={{
            width: 260,
            background: tokens.colors.bgSurface,
            borderRight: `1px solid ${tokens.colors.border}`,
            padding: tokens.spacing[4],
            overflowY: "auto",
        }}
    >
        <div
            style={{
                fontSize: 11,
                fontWeight: 600,
                color: tokens.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: tokens.spacing[2],
            }}
        >
            Task attributes
        </div>
        <PaletteItem
            key_="name"
            label="Task name"
            icon={<Type size={14} strokeWidth={1.75} />}
            inUse={usedFieldKeys.has("name")}
        />

        <div
            style={{
                fontSize: 11,
                fontWeight: 600,
                color: tokens.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                margin: `${tokens.spacing[4]}px 0 ${tokens.spacing[2]}px`,
            }}
        >
            Custom fields for this list
        </div>
        {availableCustomFields.map((cf) => (
            <PaletteItem
                key={cf.id}
                key_={cf.id}
                label={cf.name}
                icon={TYPE_ICONS[cf.type]}
                inUse={usedFieldKeys.has(cf.id)}
            />
        ))}
        {availableCustomFields.length === 0 && (
            <div
                style={{
                    fontSize: 12,
                    color: tokens.colors.textMuted,
                    padding: tokens.spacing[3],
                }}
            >
                No custom fields configured for this list. Add some in
                Settings → Custom Fields.
            </div>
        )}
    </aside>
);

const PaletteItem = ({
    key_,
    label,
    icon,
    inUse,
}: {
    key_: string;
    label: string;
    icon: React.ReactNode;
    inUse: boolean;
}) => {
    const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
        id: `palette:${key_}`,
        disabled: inUse,
    });
    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                background: inUse
                    ? tokens.colors.bgPage
                    : tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.md,
                marginBottom: 4,
                cursor: inUse ? "not-allowed" : "grab",
                fontSize: tokens.typography.fontSize.sm,
                color: inUse
                    ? tokens.colors.textMuted
                    : tokens.colors.textPrimary,
                opacity: isDragging ? 0.4 : 1,
            }}
        >
            <span style={{ color: tokens.colors.textMuted }}>{icon}</span>
            <span style={{ flex: 1 }}>{label}</span>
            {inUse && (
                <span
                    style={{
                        fontSize: 10,
                        color: tokens.colors.textMuted,
                    }}
                >
                    in use
                </span>
            )}
        </div>
    );
};

// ─── Canvas ─────────────────────────────────────────────
const FormCanvas = ({
    draft,
    selectedFieldId,
    onSelectField,
    onRemoveField,
    onUpdateField,
    onUpdateForm,
}: {
    draft: Form;
    selectedFieldId: string | null;
    onSelectField: (id: string | null) => void;
    onRemoveField: (id: string) => void;
    onUpdateField: (id: string, patch: Partial<FormFieldDef>) => void;
    onUpdateForm: (patch: Partial<Form>) => void;
}) => {
    const { setNodeRef, isOver } = useDroppable({ id: "form-canvas" });

    return (
        <div
            style={{
                flex: 1,
                background: tokens.colors.bgPage,
                overflow: "auto",
                padding: tokens.spacing[6],
            }}
        >
            <div
                ref={setNodeRef}
                style={{
                    maxWidth: 640,
                    margin: "0 auto",
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${isOver ? draft.branding.primaryColor : tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    padding: tokens.spacing[6],
                    minHeight: 400,
                    transition: "border-color var(--transition-base)",
                }}
                onClick={(e) => {
                    if (e.target === e.currentTarget) onSelectField(null);
                }}
            >
                {/* Form description */}
                <Input
                    value={draft.title}
                    onChange={(e) => onUpdateForm({ title: e.target.value })}
                    bordered={false}
                    style={{
                        fontSize: tokens.typography.fontSize["2xl"],
                        fontWeight: 700,
                        padding: 0,
                        marginBottom: 4,
                    }}
                    placeholder="Form title..."
                />
                <Input.TextArea
                    value={draft.description}
                    onChange={(e) =>
                        onUpdateForm({ description: e.target.value })
                    }
                    bordered={false}
                    autoSize
                    placeholder="Form description..."
                    style={{
                        padding: 0,
                        color: tokens.colors.textSecondary,
                        marginBottom: tokens.spacing[4],
                    }}
                />

                {/* Fields */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[3],
                    }}
                >
                    {draft.fields.map((field) => (
                        <CanvasField
                            key={field.id}
                            field={field}
                            isSelected={field.id === selectedFieldId}
                            onClick={() => onSelectField(field.id)}
                            onRemove={() => onRemoveField(field.id)}
                            onUpdate={(patch) =>
                                onUpdateField(field.id, patch)
                            }
                        />
                    ))}
                </div>

                {draft.fields.length === 0 && (
                    <div
                        style={{
                            padding: tokens.spacing[8],
                            textAlign: "center",
                            color: tokens.colors.textMuted,
                            background: tokens.colors.bgPage,
                            border: `2px dashed ${tokens.colors.border}`,
                            borderRadius: tokens.radius.md,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        Drag fields from the left palette to build your form
                    </div>
                )}
            </div>
        </div>
    );
};

const CanvasField = ({
    field,
    isSelected,
    onClick,
    onRemove,
    onUpdate,
}: {
    field: FormFieldDef;
    isSelected: boolean;
    onClick: () => void;
    onRemove: () => void;
    onUpdate: (patch: Partial<FormFieldDef>) => void;
}) => (
    <div
        onClick={onClick}
        style={{
            padding: tokens.spacing[3],
            border: `2px solid ${isSelected ? tokens.colors.primary : "transparent"}`,
            borderRadius: tokens.radius.md,
            cursor: "pointer",
            background: isSelected ? tokens.colors.primarySubtle : "transparent",
            position: "relative",
        }}
    >
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
            }}
        >
            <GripVertical
                size={12}
                strokeWidth={1.5}
                color={tokens.colors.textMuted}
            />
            <Input
                value={field.label}
                onChange={(e) => onUpdate({ label: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                bordered={false}
                style={{
                    fontWeight: 600,
                    fontSize: tokens.typography.fontSize.sm,
                    padding: 0,
                    flex: 1,
                }}
            />
            {field.isRequired && (
                <span style={{ color: tokens.colors.danger }}>*</span>
            )}
            <Button
                size="small"
                type="text"
                danger
                icon={<Trash2 size={12} strokeWidth={1.75} />}
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
            />
        </div>
        {field.helpText && (
            <div
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    marginBottom: 6,
                }}
            >
                {field.helpText}
            </div>
        )}
        {/* Placeholder rendering — show actual control */}
        <div style={{ opacity: 0.6, pointerEvents: "none" }}>
            <Input
                placeholder={field.placeholder ?? "User will input here..."}
                readOnly
            />
        </div>
    </div>
);

// ─── Properties Panel ────────────────────────────────────
const FormFieldProperties = ({
    field,
    onUpdate,
}: {
    field: FormFieldDef | null;
    onUpdate: (patch: Partial<FormFieldDef>) => void;
}) => {
    if (!field) {
        return (
            <aside
                style={{
                    width: 280,
                    background: tokens.colors.bgSurface,
                    borderLeft: `1px solid ${tokens.colors.border}`,
                    padding: tokens.spacing[5],
                    color: tokens.colors.textMuted,
                    fontSize: tokens.typography.fontSize.sm,
                    textAlign: "center",
                }}
            >
                Select a field to edit its properties
            </aside>
        );
    }

    return (
        <aside
            style={{
                width: 280,
                background: tokens.colors.bgSurface,
                borderLeft: `1px solid ${tokens.colors.border}`,
                padding: tokens.spacing[4],
                overflowY: "auto",
            }}
        >
            <h3
                style={{
                    margin: 0,
                    marginBottom: tokens.spacing[3],
                    fontSize: tokens.typography.fontSize.base,
                    fontWeight: 600,
                }}
            >
                Field properties
            </h3>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: tokens.spacing[3],
                }}
            >
                <div>
                    <label style={labelStyle}>Label</label>
                    <Input
                        value={field.label}
                        onChange={(e) => onUpdate({ label: e.target.value })}
                    />
                </div>
                <div>
                    <label style={labelStyle}>Help text</label>
                    <Input
                        value={field.helpText ?? ""}
                        onChange={(e) =>
                            onUpdate({ helpText: e.target.value })
                        }
                        placeholder="Optional helper text..."
                    />
                </div>
                <div>
                    <label style={labelStyle}>Placeholder</label>
                    <Input
                        value={field.placeholder ?? ""}
                        onChange={(e) =>
                            onUpdate({ placeholder: e.target.value })
                        }
                    />
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <label style={labelStyle}>Required</label>
                    <Switch
                        checked={field.isRequired}
                        onChange={(v) => onUpdate({ isRequired: v })}
                    />
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <label style={labelStyle}>Hidden</label>
                    <Switch
                        checked={field.isHidden}
                        onChange={(v) => onUpdate({ isHidden: v })}
                    />
                </div>

            </div>
        </aside>
    );
};

// ─── Settings Panel ─────────────────────────────────────
const FormSettingsPanel = ({
    draft,
    onChange,
}: {
    draft: Form;
    onChange: (s: Partial<Form["settings"]>) => void;
}) => (
    <div
        style={{
            flex: 1,
            padding: tokens.spacing[6],
            overflow: "auto",
            background: tokens.colors.bgPage,
        }}
    >
        <div
            style={{
                maxWidth: 560,
                margin: "0 auto",
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                padding: tokens.spacing[5],
            }}
        >
            <h2
                style={{
                    margin: 0,
                    marginBottom: tokens.spacing[4],
                    fontSize: tokens.typography.fontSize.lg,
                    fontWeight: 600,
                }}
            >
                Form settings
            </h2>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: tokens.spacing[4],
                }}
            >
                <ToggleRow
                    label="Require login"
                    desc="Only signed-in users can submit"
                    checked={draft.settings.requireLogin}
                    onChange={(v) => onChange({ requireLogin: v })}
                />
                <ToggleRow
                    label="Enable reCAPTCHA"
                    desc="Block bot submissions"
                    checked={draft.settings.enableRecaptcha}
                    onChange={(v) => onChange({ enableRecaptcha: v })}
                />
                <ToggleRow
                    label="Accepting submissions"
                    desc="Turn off to pause the form"
                    checked={draft.settings.submissionOpen}
                    onChange={(v) => onChange({ submissionOpen: v })}
                />
                <div>
                    <label style={labelStyle}>Redirect URL after submit</label>
                    <Input
                        value={draft.settings.redirectUrl ?? ""}
                        onChange={(e) =>
                            onChange({ redirectUrl: e.target.value || null })
                        }
                        placeholder="https://your-thank-you-page.com (optional)"
                    />
                    <div
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            marginTop: 4,
                        }}
                    >
                        If empty, submitter sees the success message below.
                    </div>
                </div>
                <div>
                    <label style={labelStyle}>Success message</label>
                    <Input.TextArea
                        value={draft.settings.successMessage ?? ""}
                        onChange={(e) =>
                            onChange({ successMessage: e.target.value })
                        }
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        placeholder="Thanks — we've received your submission."
                    />
                </div>
            </div>
        </div>
    </div>
);

// ─── Branding Panel ─────────────────────────────────────
const FormBrandingPanel = ({
    draft,
    onChange,
}: {
    draft: Form;
    onChange: (b: Partial<Form["branding"]>) => void;
}) => (
    <div
        style={{
            flex: 1,
            padding: tokens.spacing[6],
            overflow: "auto",
            background: tokens.colors.bgPage,
        }}
    >
        <div
            style={{
                maxWidth: 560,
                margin: "0 auto",
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                padding: tokens.spacing[5],
            }}
        >
            <h2
                style={{
                    margin: 0,
                    marginBottom: tokens.spacing[4],
                    fontSize: tokens.typography.fontSize.lg,
                    fontWeight: 600,
                }}
            >
                Branding
            </h2>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: tokens.spacing[4],
                }}
            >
                <div>
                    <label style={labelStyle}>Primary color</label>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        <ColorPicker
                            value={draft.branding.primaryColor}
                            onChange={(c) =>
                                onChange({ primaryColor: c.toHexString() })
                            }
                            size="small"
                        />
                        <code
                            style={{
                                fontFamily:
                                    tokens.typography.fontFamilyMono,
                                fontSize: 12,
                                color: tokens.colors.textSecondary,
                            }}
                        >
                            {draft.branding.primaryColor}
                        </code>
                    </div>
                </div>
                <div>
                    <label style={labelStyle}>Layout</label>
                    <div
                        style={{
                            display: "inline-flex",
                            background: tokens.colors.bgMuted,
                            borderRadius: tokens.radius.md,
                            padding: 2,
                        }}
                    >
                        {(
                            ["single_column", "two_column"] as Form["branding"]["layout"][]
                        ).map((l) => (
                            <button
                                key={l}
                                onClick={() => onChange({ layout: l })}
                                style={{
                                    padding: "4px 10px",
                                    background:
                                        draft.branding.layout === l
                                            ? tokens.colors.bgSurface
                                            : "transparent",
                                    border: 0,
                                    borderRadius: tokens.radius.sm,
                                    cursor: "pointer",
                                    fontSize:
                                        tokens.typography.fontSize.sm,
                                    color:
                                        draft.branding.layout === l
                                            ? tokens.colors.textPrimary
                                            : tokens.colors.textSecondary,
                                    fontWeight:
                                        draft.branding.layout === l
                                            ? 600
                                            : 500,
                                    boxShadow:
                                        draft.branding.layout === l
                                            ? tokens.shadows.sm
                                            : "none",
                                }}
                            >
                                {l === "single_column"
                                    ? "Single column"
                                    : "Two columns"}
                            </button>
                        ))}
                    </div>
                </div>
                <ToggleRow
                    label="Hide TaskHub branding"
                    desc="Remove the “Powered by TaskHub” footer"
                    checked={draft.branding.hideAppBranding}
                    onChange={(v) => onChange({ hideAppBranding: v })}
                />
            </div>
        </div>
    </div>
);

const FormPreview = ({ draft }: { draft: Form }) => (
    <div
        style={{
            maxWidth: 560,
            margin: "0 auto",
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.xl,
            padding: tokens.spacing[8],
            boxShadow: tokens.shadows.md,
        }}
    >
        <div
            style={{
                height: 3,
                background: draft.branding.primaryColor,
                borderRadius: 999,
                marginBottom: tokens.spacing[5],
            }}
        />
        <h1
            style={{
                margin: 0,
                fontSize: tokens.typography.fontSize["2xl"],
                fontWeight: 700,
                marginBottom: tokens.spacing[2],
            }}
        >
            {draft.title}
        </h1>
        {draft.description && (
            <p
                style={{
                    margin: 0,
                    marginBottom: tokens.spacing[5],
                    color: tokens.colors.textSecondary,
                    lineHeight: 1.6,
                }}
            >
                {draft.description}
            </p>
        )}
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[3],
            }}
        >
            {draft.fields.map((f) => (
                <div key={f.id}>
                    <label style={labelStyle}>
                        {f.label}
                        {f.isRequired && (
                            <span
                                style={{
                                    color: tokens.colors.danger,
                                    marginLeft: 2,
                                }}
                            >
                                *
                            </span>
                        )}
                    </label>
                    <Input placeholder={f.placeholder ?? ""} disabled />
                </div>
            ))}
        </div>
        <Button
            type="primary"
            block
            style={{
                marginTop: tokens.spacing[4],
                background: draft.branding.primaryColor,
            }}
            disabled
        >
            Submit (preview)
        </Button>
    </div>
);

const ToggleRow = ({
    label,
    desc,
    checked,
    onChange,
}: {
    label: string;
    desc: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 0",
        }}
    >
        <div>
            <div
                style={{
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: 500,
                    color: tokens.colors.textPrimary,
                }}
            >
                {label}
            </div>
            <div
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    marginTop: 2,
                }}
            >
                {desc}
            </div>
        </div>
        <Switch checked={checked} onChange={onChange} />
    </div>
);

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: 500,
    color: tokens.colors.textSecondary,
    marginBottom: 4,
};

export default FormBuilderPage;
