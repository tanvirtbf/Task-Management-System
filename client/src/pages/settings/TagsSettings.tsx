import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Input,
    Modal,
    Popconfirm,
    App as AntApp,
} from "antd";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { tagsApi } from "../../http/api";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";
import type { Tag } from "../../types";

const TAG_PALETTE = [
    "#4F46E5",
    "#10B981",
    "#F59E0B",
    "#E11D48",
    "#8B5CF6",
    "#06B6D4",
    "#EC4899",
    "#64748B",
    "#0EA5E9",
    "#DC2626",
];

const TagsSettings = () => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState<Tag | "new" | null>(null);

    const { data: tags = [] } = useQuery({
        queryKey: ["tags"],
        queryFn: () => tagsApi.list(),
    });

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return tags.filter((t) => !q || t.name.toLowerCase().includes(q));
    }, [tags, query]);

    const remove = useMutation({
        mutationFn: (id: string) => tagsApi.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["tags"] });
            message.success("Tag deleted");
        },
    });

    return (
        <div>
            <SettingsHeader
                title="Tags"
                description={`${tags.length} workspace-wide tags.`}
                actions={
                    <Button
                        type="primary"
                        icon={<Plus size={14} strokeWidth={2} />}
                        onClick={() => setEditing("new")}
                    >
                        New tag
                    </Button>
                }
            />

            <div
                style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: tokens.spacing[3],
                }}
            >
                <Input
                    prefix={
                        <Search
                            size={13}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    }
                    placeholder="Search tags..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ flex: 1 }}
                />
            </div>

            <SettingsSection>
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                    }}
                >
                    {filtered.map((tag) => (
                        <div
                            key={tag.id}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                background: `${tag.color}1A`,
                                color: tag.color,
                                padding: "4px 10px",
                                borderRadius: tokens.radius.full,
                                fontSize: 12,
                                fontWeight: 600,
                                border: `1px solid ${tag.color}33`,
                            }}
                        >
                            <span>{tag.name}</span>
                            <button
                                onClick={() => setEditing(tag)}
                                style={{
                                    background: "transparent",
                                    border: 0,
                                    color: "inherit",
                                    cursor: "pointer",
                                    padding: 2,
                                    display: "inline-flex",
                                    opacity: 0.7,
                                }}
                                title="Edit"
                            >
                                <Pencil size={11} strokeWidth={1.75} />
                            </button>
                            <Popconfirm
                                title={`Delete tag “${tag.name}”?`}
                                okType="danger"
                                onConfirm={() => remove.mutate(tag.id)}
                            >
                                <button
                                    style={{
                                        background: "transparent",
                                        border: 0,
                                        color: "inherit",
                                        cursor: "pointer",
                                        padding: 2,
                                        display: "inline-flex",
                                        opacity: 0.7,
                                    }}
                                    title="Delete"
                                >
                                    <Trash2 size={11} strokeWidth={1.75} />
                                </button>
                            </Popconfirm>
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <div
                            style={{
                                padding: 24,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            No tags match your filters.
                        </div>
                    )}
                </div>
            </SettingsSection>

            {editing && (
                <TagEditor
                    tag={editing === "new" ? null : editing}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
};

const TagEditor = ({
    tag,
    onClose,
}: {
    tag: Tag | null;
    onClose: () => void;
}) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [name, setName] = useState(tag?.name ?? "");
    const [color, setColor] = useState(tag?.color ?? TAG_PALETTE[0]);

    const save = useMutation({
        mutationFn: () =>
            tag
                ? tagsApi.update(tag.id, { name, color })
                : tagsApi.create({ name, color }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["tags"] });
            message.success(tag ? "Tag updated" : "Tag created");
            onClose();
        },
    });

    return (
        <Modal
            open
            title={tag ? "Edit tag" : "New tag"}
            onCancel={onClose}
            onOk={() => save.mutate()}
            okText={tag ? "Save" : "Create"}
            okButtonProps={{
                disabled: !name.trim(),
                loading: save.isPending,
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    paddingTop: 8,
                }}
            >
                <div>
                    <Label>Name</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. urgent"
                        autoFocus
                    />
                </div>
                <div>
                    <Label>Color</Label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {TAG_PALETTE.map((c) => (
                            <button
                                key={c}
                                onClick={() => setColor(c)}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "50%",
                                    background: c,
                                    border:
                                        color === c
                                            ? `2px solid ${tokens.colors.textPrimary}`
                                            : "2px solid transparent",
                                    cursor: "pointer",
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* Preview */}
                <div
                    style={{
                        marginTop: 8,
                        padding: 12,
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                    }}
                >
                    <Label>Preview</Label>
                    <span
                        style={{
                            display: "inline-flex",
                            background: `${color}1A`,
                            color,
                            padding: "4px 10px",
                            borderRadius: tokens.radius.full,
                            fontSize: 12,
                            fontWeight: 600,
                            border: `1px solid ${color}33`,
                        }}
                    >
                        {name || "tag name"}
                    </span>
                </div>
            </div>
        </Modal>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
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
        {children}
    </label>
);

export default TagsSettings;
