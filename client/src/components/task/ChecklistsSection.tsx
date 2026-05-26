import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton, Checkbox, Progress } from "antd";
import { ChevronDown, ChevronRight, ListChecks, Plus, Trash2 } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { tokens } from "../../theme";
import type { Checklist } from "../../types/extras";

interface ChecklistsSectionProps {
    taskId: string;
}

export const ChecklistsSection = ({ taskId }: ChecklistsSectionProps) => {
    const [collapsed, setCollapsed] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const qc = useQueryClient();

    const { data: checklists = [], isLoading } = useQuery({
        queryKey: ["checklists", taskId],
        queryFn: () => mockApi.checklists.byTask(taskId),
    });

    const createChecklist = useMutation({
        mutationFn: (name: string) => mockApi.checklists.create(taskId, name),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["checklists", taskId] });
            setNewName("");
            setCreating(false);
        },
    });

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <button
                onClick={() => setCollapsed(!collapsed)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "none",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    color: tokens.colors.textMuted,
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    width: "100%",
                }}
            >
                {collapsed ? (
                    <ChevronRight size={11} strokeWidth={2} />
                ) : (
                    <ChevronDown size={11} strokeWidth={2} />
                )}
                <ListChecks size={11} strokeWidth={1.75} />
                Checklists
                {checklists.length > 0 && (
                    <span
                        style={{
                            marginLeft: 6,
                            color: tokens.colors.textSecondary,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        {checklists.length}
                    </span>
                )}
            </button>

            {!collapsed && (
                <div style={{ marginTop: tokens.spacing[2] }}>
                    {isLoading ? (
                        <Skeleton active paragraph={{ rows: 3 }} />
                    ) : (
                        <>
                            {checklists.map((c) => (
                                <ChecklistView
                                    key={c.id}
                                    checklist={c}
                                    taskId={taskId}
                                />
                            ))}

                            {creating ? (
                                <input
                                    autoFocus
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    onBlur={() => {
                                        if (newName.trim())
                                            createChecklist.mutate(
                                                newName.trim(),
                                            );
                                        else setCreating(false);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && newName.trim())
                                            createChecklist.mutate(
                                                newName.trim(),
                                            );
                                        if (e.key === "Escape") {
                                            setNewName("");
                                            setCreating(false);
                                        }
                                    }}
                                    placeholder="Checklist name..."
                                    style={{
                                        width: "100%",
                                        padding: "6px 10px",
                                        border: `1px solid ${tokens.colors.primary}`,
                                        borderRadius: tokens.radius.md,
                                        outline: "none",
                                        marginTop: 4,
                                        fontSize: tokens.typography.fontSize.sm,
                                    }}
                                />
                            ) : (
                                <button
                                    onClick={() => setCreating(true)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: "6px 8px",
                                        background: "none",
                                        border: 0,
                                        cursor: "pointer",
                                        fontSize: tokens.typography.fontSize.sm,
                                        color: tokens.colors.textMuted,
                                        borderRadius: tokens.radius.md,
                                        marginTop: 4,
                                    }}
                                    onMouseEnter={(e) =>
                                        (e.currentTarget.style.background =
                                            tokens.colors.bgHover)
                                    }
                                    onMouseLeave={(e) =>
                                        (e.currentTarget.style.background =
                                            "transparent")
                                    }
                                >
                                    <Plus size={12} strokeWidth={1.75} />
                                    Add checklist
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const ChecklistView = ({
    checklist,
    taskId,
}: {
    checklist: Checklist;
    taskId: string;
}) => {
    const qc = useQueryClient();
    const [addingItem, setAddingItem] = useState(false);
    const [itemText, setItemText] = useState("");

    const invalidate = () =>
        qc.invalidateQueries({ queryKey: ["checklists", taskId] });

    const toggle = useMutation({
        mutationFn: (id: string) => mockApi.checklists.toggleItem(id),
        onSuccess: invalidate,
    });

    const addItem = useMutation({
        mutationFn: (text: string) =>
            mockApi.checklists.addItem(checklist.id, text),
        onSuccess: () => {
            invalidate();
            setItemText("");
            setAddingItem(false);
        },
    });

    const deleteList = useMutation({
        mutationFn: () => mockApi.checklists.deleteChecklist(checklist.id),
        onSuccess: invalidate,
    });

    const done = checklist.items.filter((i) => i.isCompleted).length;
    const total = checklist.items.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
        <div
            style={{
                background: tokens.colors.bgPage,
                border: `1px solid ${tokens.colors.borderSubtle}`,
                borderRadius: tokens.radius.md,
                padding: tokens.spacing[3],
                marginBottom: tokens.spacing[2],
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: tokens.spacing[2],
                }}
            >
                <span
                    style={{
                        fontWeight: 600,
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textPrimary,
                        flex: 1,
                    }}
                >
                    {checklist.name}
                </span>
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {done}/{total}
                </span>
                <button
                    onClick={() => deleteList.mutate()}
                    style={{
                        background: "none",
                        border: 0,
                        padding: 2,
                        cursor: "pointer",
                        color: tokens.colors.textMuted,
                        display: "flex",
                    }}
                    title="Delete checklist"
                >
                    <Trash2 size={12} strokeWidth={1.5} />
                </button>
            </div>

            {total > 0 && (
                <Progress
                    percent={percent}
                    showInfo={false}
                    size="small"
                    strokeWidth={3}
                    style={{ marginBottom: tokens.spacing[2] }}
                    strokeColor={tokens.colors.success}
                />
            )}

            {checklist.items.map((item) => (
                <div
                    key={item.id}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 0",
                    }}
                >
                    <Checkbox
                        checked={item.isCompleted}
                        onChange={() => toggle.mutate(item.id)}
                    />
                    <span
                        style={{
                            flex: 1,
                            fontSize: tokens.typography.fontSize.sm,
                            color: item.isCompleted
                                ? tokens.colors.textMuted
                                : tokens.colors.textPrimary,
                            textDecoration: item.isCompleted
                                ? "line-through"
                                : "none",
                        }}
                    >
                        {item.text}
                    </span>
                </div>
            ))}

            {addingItem ? (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 0",
                        marginTop: 4,
                    }}
                >
                    <Checkbox disabled />
                    <input
                        autoFocus
                        value={itemText}
                        onChange={(e) => setItemText(e.target.value)}
                        onBlur={() => {
                            if (itemText.trim()) addItem.mutate(itemText.trim());
                            else setAddingItem(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && itemText.trim())
                                addItem.mutate(itemText.trim());
                            if (e.key === "Escape") {
                                setItemText("");
                                setAddingItem(false);
                            }
                        }}
                        placeholder="Item..."
                        style={{
                            flex: 1,
                            border: 0,
                            outline: "none",
                            borderBottom: `1px solid ${tokens.colors.primary}`,
                            background: "transparent",
                            fontSize: tokens.typography.fontSize.sm,
                            padding: "2px 0",
                        }}
                    />
                </div>
            ) : (
                <button
                    onClick={() => setAddingItem(true)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 0 0",
                        background: "none",
                        border: 0,
                        cursor: "pointer",
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textMuted,
                    }}
                >
                    <Plus size={12} strokeWidth={1.75} />
                    Add item
                </button>
            )}
        </div>
    );
};
