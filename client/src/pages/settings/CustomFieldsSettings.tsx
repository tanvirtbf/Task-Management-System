import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Modal,
    Input,
    Select,
    Switch,
    App as AntApp,
    Popconfirm,
    Tag,
} from "antd";
import { useNavigate } from "react-router-dom";
import {
    Plus,
    Pencil,
    Trash2,
    ArrowLeft,
    Settings2,
    Type,
    DollarSign,
    Calendar as CalIcon,
    ChevronDown as DropDown,
    Phone,
    Paperclip,
} from "lucide-react";
import { customFieldsApi, listsApi } from "../../http/api";
import { useSpaceMap } from "../../hooks/useReferenceData";
import type {
    CustomField,
    CustomFieldType,
} from "../../types/custom-fields";
import { tokens } from "../../theme";
import { LoadingState } from "../../components/shared/LoadingState";

const TYPE_ICONS: Record<CustomFieldType, React.ReactNode> = {
    text: <Type size={14} strokeWidth={1.75} />,
    phone: <Phone size={14} strokeWidth={1.75} />,
    money: <DollarSign size={14} strokeWidth={1.75} />,
    date: <CalIcon size={14} strokeWidth={1.75} />,
    dropdown: <DropDown size={14} strokeWidth={1.75} />,
    files: <Paperclip size={14} strokeWidth={1.75} />,
};

const TYPE_LABELS: Record<CustomFieldType, string> = {
    text: "Text",
    phone: "Phone (BD)",
    money: "Money (৳)",
    date: "Date",
    dropdown: "Dropdown",
    files: "Files",
};

const CustomFieldsSettings = () => {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [editingField, setEditingField] = useState<CustomField | null>(null);
    const [creatingForListId, setCreatingForListId] = useState<string | null>(
        null,
    );

    const { data: allFields = [], isLoading } = useQuery({
        queryKey: ["custom-fields"],
        queryFn: () => customFieldsApi.list(),
    });

    const { data: lists = [] } = useQuery({
        queryKey: ["lists"],
        queryFn: () => listsApi.listAll(),
    });

    const spaceMap = useSpaceMap();

    // Group fields by list
    const groupedByList = useMemo(() => {
        const groups: Map<string, CustomField[]> = new Map();
        for (const f of allFields) {
            if (f.scopeType !== "list" || !f.scopeId) continue;
            const arr = groups.get(f.scopeId) ?? [];
            arr.push(f);
            groups.set(f.scopeId, arr);
        }
        for (const [k, v] of groups) {
            v.sort((a, b) => a.position - b.position);
            groups.set(k, v);
        }
        return groups;
    }, [allFields]);

    const deleteMutation = useMutation({
        mutationFn: (id: string) => customFieldsApi.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["custom-fields"] });
            message.success("Field deleted");
        },
    });

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 960,
                margin: "0 auto",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: tokens.spacing[5],
                }}
            >
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowLeft size={14} strokeWidth={1.75} />}
                    onClick={() => navigate(-1)}
                >
                    Back
                </Button>
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: tokens.spacing[6],
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: tokens.radius.lg,
                        background: tokens.colors.primarySubtle,
                        color: tokens.colors.primary,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Settings2 size={22} strokeWidth={1.75} />
                </div>
                <div>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["2xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                        }}
                    >
                        Custom Fields
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        Define data attributes for tasks. Grouped by list scope.
                    </p>
                </div>
            </div>

            {isLoading ? (
                <LoadingState />
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[5],
                    }}
                >
                    {lists.map((list) => {
                        const fields = groupedByList.get(list.id) ?? [];
                        const space = spaceMap.get(list.spaceId);
                        return (
                            <div
                                key={list.id}
                                style={{
                                    background: tokens.colors.bgSurface,
                                    border: `1px solid ${tokens.colors.border}`,
                                    borderRadius: tokens.radius.lg,
                                    // P2: `overflow: "hidden"` here deleted anything wider than the card,
                                    // with no scrollbar and no signal. Only the x axis changes; the y axis
                                    // stays hidden so the rounded corners still clip.
                                    overflowX: "auto",
                                    overflowY: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        padding: `${tokens.spacing[3]}px ${tokens.spacing[4]}px`,
                                        borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                    }}
                                >
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.05em",
                                            fontWeight: 600,
                                        }}
                                    >
                                        {space?.name}
                                    </span>
                                    <span
                                        style={{
                                            color: tokens.colors.textMuted,
                                        }}
                                    >
                                        /
                                    </span>
                                    <h3
                                        style={{
                                            margin: 0,
                                            fontSize:
                                                tokens.typography.fontSize.base,
                                            fontWeight: 600,
                                            flex: 1,
                                        }}
                                    >
                                        {list.name}
                                    </h3>
                                    <Tag>{fields.length} fields</Tag>
                                    <Button
                                        size="small"
                                        type="primary"
                                        icon={
                                            <Plus
                                                size={12}
                                                strokeWidth={2}
                                            />
                                        }
                                        onClick={() =>
                                            setCreatingForListId(list.id)
                                        }
                                    >
                                        Add field
                                    </Button>
                                </div>

                                {fields.length === 0 ? (
                                    <div
                                        style={{
                                            padding: tokens.spacing[5],
                                            textAlign: "center",
                                            color: tokens.colors.textMuted,
                                            fontSize:
                                                tokens.typography.fontSize.sm,
                                        }}
                                    >
                                        No custom fields. Click <strong>Add field</strong>{" "}
                                        to create one.
                                    </div>
                                ) : (
                                    fields.map((field) => (
                                        <div
                                            key={field.id}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 10,
                                                padding: `${tokens.spacing[3]}px ${tokens.spacing[4]}px`,
                                                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius:
                                                        tokens.radius.sm,
                                                    background:
                                                        tokens.colors.bgMuted,
                                                    color: tokens.colors.textSecondary,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                {TYPE_ICONS[field.type]}
                                            </span>
                                            <div style={{ flex: 1 }}>
                                                <div
                                                    style={{
                                                        fontWeight: 500,
                                                        fontSize:
                                                            tokens.typography
                                                                .fontSize.sm,
                                                        color: tokens.colors
                                                            .textPrimary,
                                                    }}
                                                >
                                                    {field.name}
                                                    {field.isRequired && (
                                                        <span
                                                            style={{
                                                                color: tokens.colors
                                                                    .danger,
                                                                marginLeft: 4,
                                                            }}
                                                        >
                                                            *
                                                        </span>
                                                    )}
                                                </div>
                                                <div
                                                    style={{
                                                        fontSize: 11,
                                                        color: tokens.colors
                                                            .textMuted,
                                                        fontFamily:
                                                            tokens.typography
                                                                .fontFamilyMono,
                                                    }}
                                                >
                                                    {field.id}
                                                </div>
                                            </div>
                                            <Tag>{TYPE_LABELS[field.type]}</Tag>
                                            <Button
                                                size="small"
                                                type="text"
                                                icon={
                                                    <Pencil
                                                        size={13}
                                                        strokeWidth={1.75}
                                                    />
                                                }
                                                onClick={() =>
                                                    setEditingField(field)
                                                }
                                            />
                                            <Popconfirm
                                                title="Delete this custom field?"
                                                okType="danger"
                                                onConfirm={() =>
                                                    deleteMutation.mutate(field.id)
                                                }
                                            >
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    danger
                                                    icon={
                                                        <Trash2
                                                            size={13}
                                                            strokeWidth={1.75}
                                                        />
                                                    }
                                                />
                                            </Popconfirm>
                                        </div>
                                    ))
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {(editingField || creatingForListId) && (
                <FieldEditModal
                    listId={creatingForListId ?? editingField!.scopeId!}
                    field={editingField}
                    onClose={() => {
                        setEditingField(null);
                        setCreatingForListId(null);
                    }}
                    onSaved={() => {
                        qc.invalidateQueries({
                            queryKey: ["custom-fields"],
                        });
                        setEditingField(null);
                        setCreatingForListId(null);
                    }}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Edit / Create modal
// ─────────────────────────────────────────────────────────
const FieldEditModal = ({
    listId,
    field,
    onClose,
    onSaved,
}: {
    listId: string;
    field: CustomField | null;
    onClose: () => void;
    onSaved: () => void;
}) => {
    const { message } = AntApp.useApp();
    const isEdit = !!field;
    const [name, setName] = useState(field?.name ?? "");
    const [type, setType] = useState<CustomFieldType>(field?.type ?? "text");
    const [isRequired, setIsRequired] = useState(field?.isRequired ?? false);

    const create = useMutation({
        mutationFn: () =>
            customFieldsApi.create({
                workspaceId: "ws-main",
                scopeType: "list",
                scopeId: listId,
                name,
                type,
                config: {},
                isRequired,
                defaultValue: null,
                position: 99,
                hiddenFromGuests: false,
                createdBy: "u-001",
            }),
        onSuccess: () => {
            message.success("Field created");
            onSaved();
        },
    });

    const update = useMutation({
        mutationFn: () =>
            customFieldsApi.update(field!.id, {
                name,
                isRequired,
            }),
        onSuccess: () => {
            message.success("Field updated");
            onSaved();
        },
    });

    return (
        <Modal
            open
            title={isEdit ? "Edit custom field" : "New custom field"}
            onCancel={onClose}
            okText={isEdit ? "Save" : "Create"}
            okButtonProps={{ disabled: !name.trim() }}
            onOk={() => (isEdit ? update.mutate() : create.mutate())}
            confirmLoading={create.isPending || update.isPending}
            width={460}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: tokens.spacing[3],
                    paddingTop: tokens.spacing[3],
                }}
            >
                <div>
                    <label style={labelStyle}>Field name</label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Customer Email"
                        autoFocus
                    />
                </div>
                <div>
                    <label style={labelStyle}>Type</label>
                    <Select
                        value={type}
                        onChange={(v) => setType(v as CustomFieldType)}
                        disabled={isEdit}
                        style={{ width: "100%" }}
                        options={(
                            Object.keys(TYPE_LABELS) as CustomFieldType[]
                        ).map((t) => ({
                            value: t,
                            label: (
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                    }}
                                >
                                    {TYPE_ICONS[t]}
                                    {TYPE_LABELS[t]}
                                </span>
                            ),
                        }))}
                    />
                    {isEdit && (
                        <div
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                                marginTop: 4,
                            }}
                        >
                            Type cannot be changed after creation. Delete + recreate
                            to switch.
                        </div>
                    )}
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 0",
                    }}
                >
                    <div>
                        <label style={{ ...labelStyle, marginBottom: 2 }}>
                            Required
                        </label>
                        <div
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Block task save if empty
                        </div>
                    </div>
                    <Switch checked={isRequired} onChange={setIsRequired} />
                </div>
            </div>
        </Modal>
    );
};

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: 500,
    color: tokens.colors.textSecondary,
    marginBottom: 4,
};

export default CustomFieldsSettings;
