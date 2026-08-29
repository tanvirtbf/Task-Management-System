import { useState } from "react";
import { Dropdown, Popconfirm, DatePicker, Popover } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
    ChevronDown,
    Flag,
    UserCircle,
    Tag as TagIcon,
    Calendar,
    Archive,
    Trash2,
    X,
} from "lucide-react";
import { statusesApi, listsApi, tagsApi, tasksApi } from "../../http/api";
import { useAssignablePeople } from "../../hooks/useAssignablePeople";
import { PRIORITY_LABELS, type Priority } from "../../types";
import { useBulkUpdateTasks } from "../../hooks/useTaskMutations";
import { PriorityFlag } from "../ui/PriorityFlag";
import { StatusPill } from "../ui/StatusPill";
import { tokens } from "../../theme";

interface BulkActionToolbarProps {
    listId: string;
    selectedIds: string[];
    onClear: () => void;
}

export const BulkActionToolbar = ({
    listId,
    selectedIds,
    onClear,
}: BulkActionToolbarProps) => {
    const bulkUpdate = useBulkUpdateTasks(listId);
    const qc = useQueryClient();
    const [datePickerOpen, setDatePickerOpen] = useState(false);

    const { data: statuses = [] } = useQuery({
        queryKey: ["statuses", listId],
        queryFn: () => statusesApi.byList(listId),
    });
    const { data: list } = useQuery({
        queryKey: ["list", listId],
        queryFn: () => listsApi.getById(listId),
    });
    // Active-only and teammates-first, from the one place that decides
    // both (useAssignablePeople) — this menu, the inline picker, the
    // create modal and the phone's card menu now agree on the order.
    const { people } = useAssignablePeople();
    const { data: spaceTags = [] } = useQuery({
        queryKey: ["tags", list?.spaceId],
        queryFn: () =>
            list?.spaceId
                ? tagsApi.bySpace(list.spaceId)
                : Promise.resolve([]),
        enabled: !!list?.spaceId,
    });

    const handleBulkStatus = (statusId: string) => {
        bulkUpdate.mutate({ ids: selectedIds, patch: { statusId } });
        onClear();
    };
    const handleBulkPriority = (priority: Priority) => {
        bulkUpdate.mutate({ ids: selectedIds, patch: { priority } });
        onClear();
    };
    // Membership is DELTA-based on the bulk wire (assignee_add / tag_add) —
    // "Assign"/"Tag" here ADD to the selection, they don't replace.
    const handleBulkAssignee = (userId: string) => {
        bulkUpdate.mutate({
            ids: selectedIds,
            patch: { assigneeAdd: [userId] },
        });
        onClear();
    };
    const handleBulkTag = (tagId: string) => {
        bulkUpdate.mutate({ ids: selectedIds, patch: { tagAdd: [tagId] } });
        onClear();
    };
    const handleBulkDueDate = (iso: string | null) => {
        bulkUpdate.mutate({ ids: selectedIds, patch: { dueDate: iso } });
        onClear();
    };

    const statusMenu = {
        items: statuses.map((s) => ({
            key: s.id,
            label: <StatusPill status={s} variant="subtle" size="sm" />,
            onClick: () => handleBulkStatus(s.id),
        })),
    };

    const priorityMenu = {
        items: ([1, 2, 3, 4, 0] as Priority[]).map((p) => ({
            key: String(p),
            label: (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                    }}
                >
                    <PriorityFlag priority={p} size={12} />
                    {PRIORITY_LABELS[p]}
                </span>
            ),
            onClick: () => handleBulkPriority(p),
        })),
    };

    const assigneeMenu = {
        items:
            people.length > 0
                ? people.map((u) => ({
                      key: u.id,
                      label: `${u.firstName} ${u.lastName}`,
                      onClick: () => handleBulkAssignee(u.id),
                  }))
                : [{ key: "none", label: "No active users", disabled: true }],
    };

    const tagMenu = {
        items:
            spaceTags.length > 0
                ? spaceTags.map((t) => ({
                      key: t.id,
                      label: (
                          <span
                              style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                              }}
                          >
                              <span
                                  style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: "50%",
                                      background: t.color,
                                  }}
                              />
                              {t.name}
                          </span>
                      ),
                      onClick: () => handleBulkTag(t.id),
                  }))
                : [
                      {
                          key: "none",
                          label: "No tags in this space",
                          disabled: true,
                      },
                  ],
    };

    return (
        <div
            className="bb-bottom-floating"
            style={{
                position: "fixed",
                bottom: 24,
                left: "50%",
                transform: "translateX(-50%)",
                background: tokens.colors.textPrimary,
                color: "#FFFFFF",
                borderRadius: tokens.radius.lg,
                boxShadow: tokens.shadows.lg,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                zIndex: tokens.zIndex.toast,
                animation: "slideUp var(--transition-slow)",
            }}
        >
            <span
                style={{
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: 600,
                    padding: "0 6px",
                    color: "#FFFFFF",
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                {selectedIds.length} selected
            </span>

            <Divider />

            <Dropdown menu={statusMenu} trigger={["click"]} placement="top">
                <button style={btnStyle} onMouseEnter={hover} onMouseLeave={unhover}>
                    Status
                    <ChevronDown size={12} strokeWidth={2} />
                </button>
            </Dropdown>

            <Dropdown menu={priorityMenu} trigger={["click"]} placement="top">
                <button style={btnStyle} onMouseEnter={hover} onMouseLeave={unhover}>
                    <Flag size={12} strokeWidth={1.75} /> Priority
                    <ChevronDown size={12} strokeWidth={2} />
                </button>
            </Dropdown>

            <Dropdown menu={assigneeMenu} trigger={["click"]} placement="top">
                <button style={btnStyle} onMouseEnter={hover} onMouseLeave={unhover}>
                    <UserCircle size={12} strokeWidth={1.75} /> Assign
                    <ChevronDown size={12} strokeWidth={2} />
                </button>
            </Dropdown>

            <Dropdown menu={tagMenu} trigger={["click"]} placement="top">
                <button style={btnStyle} onMouseEnter={hover} onMouseLeave={unhover}>
                    <TagIcon size={12} strokeWidth={1.75} /> Tag
                    <ChevronDown size={12} strokeWidth={2} />
                </button>
            </Dropdown>

            <Popover
                open={datePickerOpen}
                onOpenChange={setDatePickerOpen}
                trigger="click"
                placement="top"
                content={
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            width: 240,
                        }}
                    >
                        <DatePicker
                            open
                            value={null}
                            onChange={(d) => {
                                handleBulkDueDate(
                                    d
                                        ? (
                                              d as { toISOString: () => string }
                                          ).toISOString()
                                        : null,
                                );
                                setDatePickerOpen(false);
                            }}
                            popupStyle={{ position: "static" }}
                            style={{ width: "100%" }}
                        />
                        <button
                            onClick={() => {
                                handleBulkDueDate(null);
                                setDatePickerOpen(false);
                            }}
                            style={{
                                background: "transparent",
                                border: `1px solid ${tokens.colors.border}`,
                                padding: "4px 10px",
                                borderRadius: tokens.radius.sm,
                                fontSize: 12,
                                cursor: "pointer",
                                color: tokens.colors.textSecondary,
                            }}
                        >
                            Clear due date
                        </button>
                        <button
                            onClick={() => {
                                handleBulkDueDate(dayjs().toISOString());
                                setDatePickerOpen(false);
                            }}
                            style={{
                                background: "transparent",
                                border: `1px solid ${tokens.colors.border}`,
                                padding: "4px 10px",
                                borderRadius: tokens.radius.sm,
                                fontSize: 12,
                                cursor: "pointer",
                                color: tokens.colors.textSecondary,
                            }}
                        >
                            Set to today
                        </button>
                    </div>
                }
            >
                <button style={btnStyle} onMouseEnter={hover} onMouseLeave={unhover}>
                    <Calendar size={12} strokeWidth={1.75} /> Date
                    <ChevronDown size={12} strokeWidth={2} />
                </button>
            </Popover>

            <Divider />

            {/* F25 (ISS-050): Archive hides and CAN be undone (each task's
                menu grows a Restore entry); the button below is the permanent
                one. They used to be two labels for the same soft delete. */}
            <Popconfirm
                title="Archive selected tasks?"
                description="They stay restorable from each task's menu."
                onConfirm={async () => {
                    await Promise.all(
                        selectedIds.map((id) => tasksApi.archive(id)),
                    );
                    qc.invalidateQueries({
                        queryKey: ["tasks-by-list", listId],
                    });
                    onClear();
                }}
            >
                <button style={btnStyle} onMouseEnter={hover} onMouseLeave={unhover}>
                    <Archive size={12} strokeWidth={1.75} /> Archive
                </button>
            </Popconfirm>

            <Popconfirm
                title="Delete selected tasks permanently?"
                description="This cannot be undone. Use Archive to hide them instead."
                okType="danger"
                okText="Delete permanently"
                onConfirm={async () => {
                    await Promise.all(
                        // F25 (ISS-050): the plain DELETE is a SOFT delete —
                        // the same operation as Archive. This is the real one.
                        selectedIds.map((id) => tasksApi.delete(id, true)),
                    );
                    qc.invalidateQueries({
                        queryKey: ["tasks-by-list", listId],
                    });
                    onClear();
                }}
            >
                <button
                    style={{ ...btnStyle, color: "#FCA5A5" }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                            "rgba(239,68,68,0.15)")
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    <Trash2 size={12} strokeWidth={1.75} /> Delete permanently
                </button>
            </Popconfirm>

            <Divider />

            <button
                onClick={onClear}
                style={{ ...btnStyle, opacity: 0.7 }}
                title="Clear selection (Esc)"
                aria-label="Clear selection"
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
            >
                <X size={14} strokeWidth={1.75} />
            </button>
        </div>
    );
};

const hover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "rgba(255,255,255,0.1)";
};
const unhover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "transparent";
};

const Divider = () => (
    <div
        style={{
            width: 1,
            height: 20,
            background: "rgba(255,255,255,0.2)",
        }}
    />
);

const btnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: 0,
    padding: "6px 10px",
    borderRadius: tokens.radius.md,
    color: "#FFFFFF",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background var(--transition-base)",
};
