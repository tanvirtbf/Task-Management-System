import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    Button,
    Tag,
    App as AntApp,
    Dropdown,
} from "antd";
import {
    ArrowLeft,
    Plus,
    Settings2,
    Eye,
    Pencil,
    Star,
    Trash2,
    Copy,
    MoreHorizontal,
    RefreshCcw,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { WidgetCard } from "../../components/widgets/WidgetCard";
import { WidgetRenderer } from "../../components/widgets/WidgetRenderer";
import { WidgetPicker } from "../../components/widgets/WidgetPicker";
import { WidgetEditor } from "../../components/widgets/WidgetEditor";
import { LoadingState } from "../../components/shared/LoadingState";
import { tokens } from "../../theme";
import type { Dashboard, DashboardWidget } from "../../types/dashboard";

const ROW_HEIGHT_PX = 90;

const DashboardViewPage = () => {
    const { dashboardId } = useParams();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [editing, setEditing] = useState(false);
    const [picking, setPicking] = useState(false);
    const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(
        null,
    );

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    const { data: dashboard, isLoading } = useQuery({
        queryKey: ["dashboard", dashboardId],
        queryFn: () =>
            dashboardId
                ? mockApi.dashboards.getById(dashboardId)
                : Promise.resolve(null),
        enabled: !!dashboardId,
    });

    const reorder = useMutation({
        mutationFn: (ids: string[]) =>
            mockApi.dashboards.reorderWidgets(dashboardId!, ids),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: ["dashboard", dashboardId] }),
    });

    const addWidget = useMutation({
        mutationFn: (widget: Omit<DashboardWidget, "id">) =>
            mockApi.dashboards.addWidget(dashboardId!, widget),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["dashboard", dashboardId] });
            message.success("Widget added");
            setPicking(false);
        },
    });

    const updateWidget = useMutation({
        mutationFn: ({
            widgetId,
            patch,
        }: {
            widgetId: string;
            patch: Partial<DashboardWidget>;
        }) =>
            mockApi.dashboards.updateWidget(dashboardId!, widgetId, patch),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["dashboard", dashboardId] });
            message.success("Widget saved");
            setEditingWidget(null);
        },
    });

    const removeWidget = useMutation({
        mutationFn: (widgetId: string) =>
            mockApi.dashboards.removeWidget(dashboardId!, widgetId),
        onSuccess: () =>
            qc.invalidateQueries({ queryKey: ["dashboard", dashboardId] }),
    });

    const updateDashboard = useMutation({
        mutationFn: (patch: Partial<Dashboard>) =>
            mockApi.dashboards.update(dashboardId!, patch),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["dashboard", dashboardId] });
            qc.invalidateQueries({ queryKey: ["dashboards"] });
        },
    });

    if (isLoading) {
        return <LoadingState />;
    }
    if (!dashboard) {
        return (
            <div
                style={{
                    padding: 24,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    alignItems: "center",
                }}
            >
                <div>Dashboard not found.</div>
                <Button onClick={() => navigate("/dashboards")}>
                    Back to dashboards
                </Button>
            </div>
        );
    }

    const onDragEnd = (e: DragEndEvent) => {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const oldIdx = dashboard.widgets.findIndex(
            (w) => w.id === active.id,
        );
        const newIdx = dashboard.widgets.findIndex(
            (w) => w.id === over.id,
        );
        if (oldIdx < 0 || newIdx < 0) return;
        const next = arrayMove(dashboard.widgets, oldIdx, newIdx);
        reorder.mutate(next.map((w) => w.id));
    };

    const duplicateWidget = (w: DashboardWidget) => {
        const { id: _id, ...rest } = w;
        addWidget.mutate({ ...rest, title: `${w.title} (copy)` });
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                minHeight: "calc(100vh - 48px)",
            }}
        >
            {/* Sticky header */}
            <div
                style={{
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[5]}px`,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    background: tokens.colors.bgSurface,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    position: "sticky",
                    top: 0,
                    zIndex: 5,
                }}
            >
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowLeft size={14} strokeWidth={1.75} />}
                    onClick={() => navigate("/dashboards")}
                >
                    Dashboards
                </Button>
                <div
                    style={{
                        width: 1,
                        height: 20,
                        background: tokens.colors.border,
                    }}
                />
                <div
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: tokens.radius.md,
                        background: `${dashboard.color}1A`,
                        color: dashboard.color,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <DynamicIcon
                        name={dashboard.icon}
                        size={18}
                        strokeWidth={1.75}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize.lg,
                            fontWeight: 700,
                            color: tokens.colors.textPrimary,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {dashboard.name}
                    </h1>
                    <div
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        {dashboard.widgets.length} widgets · scope:{" "}
                        {dashboard.scope.type}
                    </div>
                </div>
                <Tag>{dashboard.sharing}</Tag>
                <button
                    onClick={() =>
                        updateDashboard.mutate({
                            isFavorite: !dashboard.isFavorite,
                        })
                    }
                    title={
                        dashboard.isFavorite ? "Unfavorite" : "Mark favorite"
                    }
                    style={{
                        background: "transparent",
                        border: 0,
                        cursor: "pointer",
                        padding: 4,
                        color: dashboard.isFavorite
                            ? tokens.colors.warning
                            : tokens.colors.textMuted,
                        display: "inline-flex",
                    }}
                >
                    <Star
                        size={14}
                        strokeWidth={1.75}
                        fill={
                            dashboard.isFavorite
                                ? tokens.colors.warning
                                : "none"
                        }
                    />
                </button>
                <Button
                    size="small"
                    icon={<RefreshCcw size={13} strokeWidth={1.75} />}
                    onClick={() =>
                        qc.invalidateQueries({
                            queryKey: ["dashboard", dashboardId],
                        })
                    }
                >
                    Refresh
                </Button>
                {editing ? (
                    <>
                        <Button
                            size="small"
                            type="primary"
                            icon={<Plus size={13} strokeWidth={2} />}
                            onClick={() => setPicking(true)}
                        >
                            Add widget
                        </Button>
                        <Button
                            size="small"
                            icon={<Eye size={13} strokeWidth={1.75} />}
                            onClick={() => setEditing(false)}
                        >
                            View mode
                        </Button>
                    </>
                ) : (
                    <Button
                        size="small"
                        icon={<Pencil size={13} strokeWidth={1.75} />}
                        onClick={() => setEditing(true)}
                    >
                        Edit
                    </Button>
                )}
                <Dropdown
                    menu={{
                        items: [
                            {
                                key: "settings",
                                icon: <Settings2 size={13} strokeWidth={1.75} />,
                                label: "Dashboard settings",
                            },
                            {
                                key: "duplicate",
                                icon: <Copy size={13} strokeWidth={1.75} />,
                                label: "Duplicate dashboard",
                                onClick: async () => {
                                    const d =
                                        await mockApi.dashboards.duplicate(
                                            dashboardId!,
                                        );
                                    qc.invalidateQueries({
                                        queryKey: ["dashboards"],
                                    });
                                    message.success(
                                        `Duplicated as “${d.name}”`,
                                    );
                                    navigate(`/dashboards/${d.id}`);
                                },
                            },
                        ],
                    }}
                    trigger={["click"]}
                >
                    <Button
                        size="small"
                        type="text"
                        icon={
                            <MoreHorizontal
                                size={14}
                                strokeWidth={1.75}
                            />
                        }
                    />
                </Dropdown>
            </div>

            {/* Body */}
            <div
                style={{
                    flex: 1,
                    background: tokens.colors.bgPage,
                    padding: tokens.spacing[4],
                    overflow: "auto",
                }}
            >
                {dashboard.widgets.length === 0 ? (
                    <EmptyDashboard onAdd={() => setPicking(true)} />
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={onDragEnd}
                    >
                        <SortableContext
                            items={dashboard.widgets.map((w) => w.id)}
                            strategy={rectSortingStrategy}
                        >
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                        "repeat(12, minmax(0, 1fr))",
                                    gridAutoRows: `${ROW_HEIGHT_PX}px`,
                                    gap: tokens.spacing[3],
                                    maxWidth: 1440,
                                    margin: "0 auto",
                                }}
                            >
                                {dashboard.widgets.map((w) => (
                                    <SortableWidget
                                        key={w.id}
                                        widget={w}
                                        editing={editing}
                                        onEdit={() => setEditingWidget(w)}
                                        onDuplicate={() => duplicateWidget(w)}
                                        onRemove={() =>
                                            removeWidget.mutate(w.id)
                                        }
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </div>

            {picking && (
                <WidgetPicker
                    onClose={() => setPicking(false)}
                    onPick={(w) => addWidget.mutate(w)}
                />
            )}
            {editingWidget && (
                <WidgetEditor
                    widget={editingWidget}
                    onClose={() => setEditingWidget(null)}
                    onSave={(patch) =>
                        updateWidget.mutate({
                            widgetId: editingWidget.id,
                            patch,
                        })
                    }
                />
            )}
        </div>
    );
};

const SortableWidget = ({
    widget,
    editing,
    onEdit,
    onDuplicate,
    onRemove,
}: {
    widget: DashboardWidget;
    editing: boolean;
    onEdit: () => void;
    onDuplicate: () => void;
    onRemove: () => void;
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: widget.id, disabled: !editing });

    const colSpan = Math.max(2, Math.min(12, widget.colSpan));
    const rowSpan = Math.max(1, Math.min(3, widget.rowSpan));

    const style: React.CSSProperties = {
        gridColumn: `span ${colSpan}`,
        gridRow: `span ${rowSpan}`,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes}>
            <WidgetCard
                widget={widget}
                editing={editing}
                dragHandleProps={listeners}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onRemove={onRemove}
                bare={widget.type === "text"}
            >
                <WidgetRenderer widget={widget} />
            </WidgetCard>
        </div>
    );
};

const EmptyDashboard = ({ onAdd }: { onAdd: () => void }) => (
    <div
        style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 64,
            background: tokens.colors.bgSurface,
            border: `2px dashed ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            maxWidth: 480,
            margin: "60px auto",
            gap: 12,
        }}
    >
        <div
            style={{
                width: 56,
                height: 56,
                borderRadius: tokens.radius.lg,
                background: tokens.colors.primarySubtle,
                color: tokens.colors.primary,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            <Plus size={28} strokeWidth={1.5} />
        </div>
        <h3
            style={{
                margin: 0,
                fontSize: tokens.typography.fontSize.lg,
                fontWeight: 700,
            }}
        >
            Build your dashboard
        </h3>
        <p
            style={{
                margin: 0,
                color: tokens.colors.textMuted,
                textAlign: "center",
                fontSize: tokens.typography.fontSize.sm,
                maxWidth: 320,
            }}
        >
            Add widgets to track KPIs, see workload, or surface a filtered
            task list.
        </p>
        <Button
            type="primary"
            icon={<Plus size={14} strokeWidth={2} />}
            onClick={onAdd}
        >
            Add the first widget
        </Button>
    </div>
);

export default DashboardViewPage;
