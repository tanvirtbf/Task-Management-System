import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Skeleton,
    Checkbox,
    Progress,
    Button,
    Input,
    Select,
    App as AntApp,
} from "antd";
import { ChevronDown, ChevronRight, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { checklistsApi, usersApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
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
    const { message } = AntApp.useApp();

    const { data: checklists = [], isLoading } = useQuery({
        queryKey: ["checklists", taskId],
        queryFn: () => checklistsApi.byTask(taskId),
    });

    // upgrades/022 — the task-level rollup shown beside the section title.
    const totalAll = checklists.reduce((n, c) => n + c.items.length, 0);
    const doneAll = checklists.reduce(
        (n, c) => n + c.items.filter((i) => i.isCompleted).length,
        0,
    );
    const pctAll =
        totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;

    const createChecklist = useMutation({
        mutationFn: (name: string) => checklistsApi.create(taskId, name),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["checklists", taskId] });
            setNewName("");
            setCreating(false);
        },
        onError: (err) => message.error(getApiErrorMessage(err)),
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
                {totalAll > 0 && (
                    <span
                        style={{
                            marginLeft: 8,
                            color:
                                pctAll === 100
                                    ? tokens.colors.success
                                    : tokens.colors.textSecondary,
                            fontFamily: tokens.typography.fontFamilyMono,
                            textTransform: "none",
                            letterSpacing: 0,
                        }}
                        title="Checklist items done across this task"
                    >
                        {doneAll}/{totalAll} · {pctAll}%
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
    const { message } = AntApp.useApp();
    const [addingItem, setAddingItem] = useState(false);
    const [itemText, setItemText] = useState("");
    // click-to-edit state: the checklist name, and one item's text at a time
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(checklist.name);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [itemDraft, setItemDraft] = useState("");

    // Item writes move the task's rollup counters (upgrades/022) — refresh
    // the drawer header, the open task and the row chips along with the list.
    const invalidate = () => {
        qc.invalidateQueries({ queryKey: ["checklists", taskId] });
        qc.invalidateQueries({ queryKey: ["task", taskId] });
        qc.invalidateQueries({ queryKey: ["tasks-by-list"] });
    };
    // A refused write must say WHY (the server's human message — e.g. the
    // team-access edit rule), never fail silently.
    const onError = (err: unknown) => message.error(getApiErrorMessage(err));

    const toggle = useMutation({
        mutationFn: (id: string) => checklistsApi.toggleItem(id),
        onSuccess: invalidate,
        onError,
    });

    const rename = useMutation({
        mutationFn: (name: string) => checklistsApi.rename(checklist.id, name),
        onSuccess: () => {
            invalidate();
            setEditingName(false);
        },
        onError,
    });

    const editItem = useMutation({
        mutationFn: (input: { id: string; text: string }) =>
            checklistsApi.updateItem(input.id, { text: input.text }),
        onSuccess: () => {
            invalidate();
            setEditingItemId(null);
        },
        onError,
    });

    const removeItem = useMutation({
        mutationFn: (id: string) => checklistsApi.deleteItem(id),
        onSuccess: invalidate,
        onError,
    });

    /**
     * F28 (ISS-070, decision D12.3). `checklist_items.assignee_id` has always
     * existed and has always been validated properly — an unknown id and an
     * `invited`-status user both answer 422 `checklist_item.invalid_assignee` —
     * but NO screen in the client ever rendered a control for it. Measured
     * before building: 14 checklist items in the demo workspace, zero with an
     * assignee, because the only way to set one was to call the API by hand.
     *
     * ISS-070 asked for a per-item DUE DATE on the grounds that assigning
     * without a date leaves "who" answered and "by when" unanswerable. D12.3
     * settled it the other way: item-level dates stay out (they would be a
     * second deadline system that My Work, Agenda, the overdue KPI and the
     * calendar all key off `tasks.due_date` and would not read), and a subtask
     * remains the primitive for "who, by when". What was actually missing was
     * the half that already worked.
     */
    const { data: members = [] } = useQuery({
        queryKey: ["users"],
        queryFn: () => usersApi.list(),
    });

    const assign = useMutation({
        mutationFn: (input: { id: string; assigneeId: string | null }) =>
            checklistsApi.updateItem(input.id, {
                assigneeId: input.assigneeId,
            }),
        onSuccess: invalidate,
        onError,
    });

    // Only ACTIVE members can hold an item — the server refuses an `invited`
    // user with 422, so offering one would be a dead option.
    const assigneeOptions = members
        .filter((m) => m.status === "active")
        .map((m) => ({
            value: m.id,
            label: `${m.firstName} ${m.lastName}`.trim() || m.email,
        }));

    /**
     * F25 (ISS-069): items arrive as a FLAT array carrying `parent_item_id`;
     * the client used to render them all as siblings, so a sub-item looked
     * identical to a top-level one and there was no way to make one. Build the
     * tree here (order preserved: the server sorts by `position`) and indent
     * each level. Depth is not capped server-side; the indent is, so a deep
     * tree stays readable.
     */
    const [subItemFor, setSubItemFor] = useState<string | null>(null);
    const [subItemText, setSubItemText] = useState("");

    const addItem = useMutation({
        mutationFn: (input: { text: string; parentItemId?: string | null }) =>
            checklistsApi.addItem(
                checklist.id,
                input.text,
                input.parentItemId,
            ),
        onSuccess: () => {
            invalidate();
            setItemText("");
            setAddingItem(false);
            setSubItemFor(null);
            setSubItemText("");
        },
        onError,
    });

    /** Flat array -> tree, preserving the server's `position` order. */
    const childrenOf = (parentId: string | null) =>
        checklist.items.filter((i) => (i.parentItemId ?? null) === parentId);

    const renderItems = (
        parentId: string | null,
        depth: number,
    ): ReactNode =>
        childrenOf(parentId).map((item) => (
            <div key={item.id}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 0",
                        // cap the indent so a deep tree stays readable
                        paddingLeft: Math.min(depth, 4) * 20,
                    }}
                >
                    <Checkbox
                        checked={item.isCompleted}
                        onChange={() => toggle.mutate(item.id)}
                    />
                    {editingItemId === item.id ? (
                        <Input
                            size="small"
                            autoFocus
                            value={itemDraft}
                            style={{ flex: 1 }}
                            maxLength={500}
                            onChange={(e) => setItemDraft(e.target.value)}
                            onPressEnter={() => {
                                if (itemDraft.trim())
                                    editItem.mutate({
                                        id: item.id,
                                        text: itemDraft.trim(),
                                    });
                            }}
                            onBlur={() => {
                                if (
                                    itemDraft.trim() &&
                                    itemDraft.trim() !== item.text
                                )
                                    editItem.mutate({
                                        id: item.id,
                                        text: itemDraft.trim(),
                                    });
                                else setEditingItemId(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Escape")
                                    setEditingItemId(null);
                            }}
                        />
                    ) : (
                        <span
                            onClick={() => {
                                setEditingItemId(item.id);
                                setItemDraft(item.text);
                            }}
                            title="Click to edit"
                            style={{
                                flex: 1,
                                cursor: "text",
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
                    )}
                    <Select
                        size="small"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder="Assign"
                        title="Assign this item to someone"
                        value={item.assigneeId ?? undefined}
                        options={assigneeOptions}
                        onChange={(v) =>
                            assign.mutate({
                                id: item.id,
                                assigneeId: v ?? null,
                            })
                        }
                        style={{ width: 132, flexShrink: 0 }}
                    />
                    <Button
                        type="text"
                        size="small"
                        icon={<Plus size={11} strokeWidth={2} />}
                        title="Add a sub-item"
                        onClick={() => {
                            setSubItemFor(item.id);
                            setSubItemText("");
                        }}
                    />
                    <Button
                        type="text"
                        size="small"
                        icon={<Trash2 size={11} strokeWidth={1.5} />}
                        title="Delete this item"
                        onClick={() => removeItem.mutate(item.id)}
                    />
                </div>
                {subItemFor === item.id && (
                    <div
                        style={{
                            display: "flex",
                            gap: 6,
                            padding: "2px 0",
                            paddingLeft: Math.min(depth + 1, 4) * 20 + 24,
                        }}
                    >
                        <Input
                            size="small"
                            autoFocus
                            value={subItemText}
                            placeholder="Sub-item…"
                            onChange={(e) => setSubItemText(e.target.value)}
                            onPressEnter={() => {
                                if (subItemText.trim())
                                    addItem.mutate({
                                        text: subItemText.trim(),
                                        parentItemId: item.id,
                                    });
                            }}
                            onBlur={() => {
                                if (subItemText.trim())
                                    addItem.mutate({
                                        text: subItemText.trim(),
                                        parentItemId: item.id,
                                    });
                                else setSubItemFor(null);
                            }}
                        />
                    </div>
                )}
                {renderItems(item.id, depth + 1)}
            </div>
        ));

    const deleteList = useMutation({
        mutationFn: () => checklistsApi.deleteChecklist(checklist.id),
        onSuccess: invalidate,
        onError,
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
                {editingName ? (
                    <Input
                        size="small"
                        autoFocus
                        value={nameDraft}
                        style={{ flex: 1 }}
                        maxLength={120}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onPressEnter={() => {
                            if (nameDraft.trim())
                                rename.mutate(nameDraft.trim());
                        }}
                        onBlur={() => {
                            if (
                                nameDraft.trim() &&
                                nameDraft.trim() !== checklist.name
                            )
                                rename.mutate(nameDraft.trim());
                            else setEditingName(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingName(false);
                        }}
                    />
                ) : (
                    <span
                        onClick={() => {
                            setEditingName(true);
                            setNameDraft(checklist.name);
                        }}
                        title="Click to rename"
                        style={{
                            fontWeight: 600,
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textPrimary,
                            flex: 1,
                            cursor: "text",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                        }}
                    >
                        {checklist.name}
                        <Pencil
                            size={10}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    </span>
                )}
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

            {renderItems(null, 0)}

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
                            if (itemText.trim())
                                addItem.mutate({ text: itemText.trim() });
                            else setAddingItem(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && itemText.trim())
                                addItem.mutate({ text: itemText.trim() });
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
