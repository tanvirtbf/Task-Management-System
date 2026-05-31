import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams, NavLink } from "react-router-dom";
import {
    LayoutList,
    LayoutGrid,
    Calendar,
    FileText,
    MoreHorizontal,
    UserPlus,
} from "lucide-react";
import { Button } from "antd";
import { listsApi, spacesApi, tasksApi } from "../../http/api";
import { useUserMap } from "../../hooks/useReferenceData";
import { AssigneeStack } from "../../components/ui/AssigneeStack";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { InlineNameEdit } from "../../components/task/InlineNameEdit";
import { ListView } from "../../components/views/ListView";
import { BoardView } from "../../components/views/BoardView";
import { CalendarView } from "../../components/views/CalendarView";
import { FormView } from "../../components/views/FormView";
import { TaskDetailDrawer } from "../../components/task/TaskDetailDrawer";
import { tokens } from "../../theme";

const viewTabs = [
    { id: "list", label: "List", icon: LayoutList, available: true },
    { id: "board", label: "Board", icon: LayoutGrid, available: true },
    { id: "calendar", label: "Calendar", icon: Calendar, available: true },
    { id: "form", label: "Form", icon: FileText, available: true },
];

const ListPage = () => {
    const { spaceId, listId, viewId } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const openTaskId = searchParams.get("task");

    // Default view is "list"; URL `:viewId` (e.g., "board") overrides
    const currentView = viewId ?? "list";

    const { data: list } = useQuery({
        queryKey: ["list", listId],
        queryFn: () => (listId ? listsApi.getById(listId) : null),
        enabled: !!listId,
    });

    const { data: space } = useQuery({
        queryKey: ["space", spaceId],
        queryFn: () => (spaceId ? spacesApi.getById(spaceId) : null),
        enabled: !!spaceId,
    });

    const { data: tasks = [] } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () =>
            listId ? tasksApi.listByList(listId) : Promise.resolve([]),
        enabled: !!listId,
    });
    const userMap = useUserMap();
    const memberIds = Array.from(
        new Set(tasks.flatMap((t) => t.assignees)),
    ).slice(0, 8);
    const members = memberIds
        .map((id) => userMap.get(id))
        .filter((u): u is NonNullable<typeof u> => !!u);

    if (!list || !listId) return null;

    const renderView = () => {
        switch (currentView) {
            case "board":
                return <BoardView listId={listId} />;
            case "calendar":
                return <CalendarView listId={listId} />;
            case "form":
                return <FormView listId={listId} />;
            case "list":
            default:
                return <ListView listId={listId} />;
        }
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                minHeight: "100%",
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: `${tokens.spacing[5]}px ${tokens.spacing[6]}px 0`,
                    background: tokens.colors.bgSurface,
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: tokens.spacing[3],
                    }}
                >
                    {list.icon && list.color && (
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: tokens.radius.md,
                                background: `${list.color}1A`,
                                color: list.color,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                marginTop: 2,
                            }}
                        >
                            <DynamicIcon
                                name={list.icon}
                                size={18}
                                strokeWidth={1.75}
                            />
                        </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h1
                            style={{
                                margin: 0,
                                fontSize: tokens.typography.fontSize["2xl"],
                                fontWeight: 700,
                                letterSpacing: "-0.02em",
                                color: tokens.colors.textPrimary,
                                lineHeight: 1.2,
                            }}
                        >
                            <InlineNameEdit
                                value={list.name}
                                onSave={() => {
                                    /* List rename: Phase 10 settings */
                                }}
                                size="lg"
                            />
                        </h1>
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textMuted,
                                marginTop: 2,
                            }}
                        >
                            {list.description ??
                                `${space?.name} · ${tasks.length} tasks`}
                        </div>
                    </div>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexShrink: 0,
                        }}
                    >
                        {members.length > 0 && (
                            <AssigneeStack users={members} max={4} />
                        )}
                        <Button
                            size="small"
                            icon={<UserPlus size={13} strokeWidth={1.75} />}
                        >
                            Invite
                        </Button>
                        <Button
                            size="small"
                            type="text"
                            icon={
                                <MoreHorizontal size={14} strokeWidth={1.75} />
                            }
                        />
                    </div>
                </div>

                {/* View tabs */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                        marginTop: tokens.spacing[4],
                        marginBottom: -1,
                        overflowX: "auto",
                    }}
                >
                    {viewTabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = tab.id === currentView;
                        const tabPath =
                            tab.id === "list"
                                ? `/s/${spaceId}/l/${listId}`
                                : `/s/${spaceId}/l/${listId}/${tab.id}`;
                        return (
                            <NavLink
                                key={tab.id}
                                to={tabPath}
                                end={tab.id === "list"}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    padding: "8px 12px",
                                    borderRadius: `${tokens.radius.md}px ${tokens.radius.md}px 0 0`,
                                    background: isActive
                                        ? tokens.colors.bgSurface
                                        : "transparent",
                                    color: isActive
                                        ? tokens.colors.primary
                                        : tab.available
                                          ? tokens.colors.textSecondary
                                          : tokens.colors.textMuted,
                                    fontSize: tokens.typography.fontSize.sm,
                                    fontWeight: isActive ? 600 : 500,
                                    textDecoration: "none",
                                    cursor: tab.available
                                        ? "pointer"
                                        : "not-allowed",
                                    opacity: tab.available ? 1 : 0.5,
                                    pointerEvents: tab.available
                                        ? "auto"
                                        : "none",
                                    borderBottom: isActive
                                        ? `2px solid ${tokens.colors.primary}`
                                        : "2px solid transparent",
                                }}
                            >
                                <Icon size={13} strokeWidth={1.75} />
                                {tab.label}
                            </NavLink>
                        );
                    })}
                </div>
            </div>

            {renderView()}

            <TaskDetailDrawer
                taskId={openTaskId}
                listId={listId}
                onClose={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("task");
                    setSearchParams(next, { replace: true });
                }}
            />
        </div>
    );
};

export default ListPage;
