import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, Select, DatePicker } from "antd";
import {
    Activity as ActivityIcon,
    Filter,
    User as UserIcon,
} from "lucide-react";
import dayjs from "dayjs";
import { mockApi } from "../../lib/mock-api";
import { usersById, users as allUsers } from "../../mocks/users";
import { Avatar } from "../ui/Avatar";
import { EmptyState } from "../ui/EmptyState";
import { tokens } from "../../theme";

interface ActivityViewProps {
    listId: string;
}

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
    created: "created",
    status_changed: "moved status of",
    assigned: "was assigned to",
    comment_posted: "commented on",
    completed: "completed",
    priority_changed: "changed priority on",
    moved: "moved",
    due_date_changed: "changed due date on",
    tag_added: "tagged",
    attachment_added: "added attachment to",
};

const ACTION_COLORS: Record<string, string> = {
    created: "#10B981",
    status_changed: "#3B82F6",
    assigned: "#8B5CF6",
    comment_posted: "#F59E0B",
    completed: "#059669",
    priority_changed: "#E11D48",
    moved: "#06B6D4",
    due_date_changed: "#F59E0B",
    tag_added: "#EC4899",
    attachment_added: "#0EA5E9",
};

const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / (1000 * 60));
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
};

export const ActivityView = ({ listId }: ActivityViewProps) => {
    const navigate = useNavigate();
    const [page, setPage] = useState(0);
    const [actorFilter, setActorFilter] = useState<string | undefined>();
    const [actionFilter, setActionFilter] = useState<string | undefined>();
    const [sinceDate, setSinceDate] = useState<dayjs.Dayjs | null>(null);

    const { data, isLoading } = useQuery({
        queryKey: [
            "activity",
            listId,
            actorFilter,
            actionFilter,
            sinceDate?.toISOString(),
            page,
        ],
        queryFn: () =>
            mockApi.activity.filtered({
                listId,
                actorId: actorFilter,
                action: actionFilter,
                sinceDate: sinceDate?.toISOString(),
                limit: (page + 1) * PAGE_SIZE,
            }),
    });

    const entries = data?.data ?? [];

    const teamMembers = useMemo(
        () => allUsers.filter((u) => u.status === "active"),
        [],
    );

    return (
        <>
            {/* Filters bar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[6]}px`,
                    background: tokens.colors.bgSurface,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    flexWrap: "wrap",
                }}
            >
                <Filter
                    size={14}
                    strokeWidth={1.75}
                    color={tokens.colors.textMuted}
                />
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                    }}
                >
                    Filter activity
                </span>

                <Select
                    placeholder="By person"
                    size="small"
                    value={actorFilter}
                    onChange={setActorFilter}
                    allowClear
                    style={{ width: 200 }}
                    showSearch
                    optionFilterProp="label"
                    options={teamMembers.map((u) => ({
                        value: u.id,
                        label: `${u.firstName} ${u.lastName}`,
                    }))}
                />

                <Select
                    placeholder="By action"
                    size="small"
                    value={actionFilter}
                    onChange={setActionFilter}
                    allowClear
                    style={{ width: 180 }}
                    options={Object.keys(ACTION_LABELS).map((a) => ({
                        value: a,
                        label: a.replace(/_/g, " "),
                    }))}
                />

                <DatePicker
                    size="small"
                    value={sinceDate}
                    onChange={setSinceDate}
                    placeholder="Since date..."
                    allowClear
                    style={{ width: 160 }}
                />

                {(actorFilter || actionFilter || sinceDate) && (
                    <Button
                        type="text"
                        size="small"
                        onClick={() => {
                            setActorFilter(undefined);
                            setActionFilter(undefined);
                            setSinceDate(null);
                        }}
                    >
                        Clear filters
                    </Button>
                )}

                <div
                    style={{
                        marginLeft: "auto",
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {entries.length} of {data?.total ?? "—"}
                </div>
            </div>

            {/* Feed */}
            <div
                style={{
                    flex: 1,
                    overflow: "auto",
                    margin: tokens.spacing[5],
                    marginTop: tokens.spacing[3],
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                }}
            >
                {isLoading && entries.length === 0 ? (
                    <div
                        style={{
                            padding: tokens.spacing[8],
                            textAlign: "center",
                            color: tokens.colors.textMuted,
                        }}
                    >
                        Loading activity...
                    </div>
                ) : entries.length === 0 ? (
                    <EmptyState
                        icon={ActivityIcon}
                        title="No activity yet"
                        description="Activity will appear here as the team works."
                    />
                ) : (
                    <>
                        <div>
                            {entries.map((entry, idx) => {
                                const actor = entry.actorId
                                    ? usersById.get(entry.actorId)
                                    : null;
                                const actorName = actor
                                    ? `${actor.firstName} ${actor.lastName}`
                                    : "Someone";
                                const verb =
                                    ACTION_LABELS[entry.action] ??
                                    entry.action.replace(/_/g, " ");
                                const color =
                                    ACTION_COLORS[entry.action] ??
                                    tokens.colors.textMuted;
                                return (
                                    <button
                                        key={entry.id}
                                        onClick={() =>
                                            entry.entityType === "task" &&
                                            navigate(`/t/${entry.entityId}`)
                                        }
                                        style={{
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: 10,
                                            padding: "12px 16px",
                                            background: "none",
                                            border: 0,
                                            cursor: "pointer",
                                            textAlign: "left",
                                            width: "100%",
                                            borderBottom:
                                                idx === entries.length - 1
                                                    ? "none"
                                                    : `1px solid ${tokens.colors.borderSubtle}`,
                                            transition:
                                                "background var(--transition-base)",
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
                                        {actor ? (
                                            <Avatar
                                                name={actorName}
                                                src={actor.avatarUrl}
                                                size={32}
                                            />
                                        ) : (
                                            <div
                                                style={{
                                                    width: 32,
                                                    height: 32,
                                                    borderRadius: "50%",
                                                    background:
                                                        tokens.colors.bgMuted,
                                                    color: tokens.colors.textMuted,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                <UserIcon
                                                    size={14}
                                                    strokeWidth={1.5}
                                                />
                                            </div>
                                        )}
                                        <div
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                paddingTop: 2,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    fontSize:
                                                        tokens.typography.fontSize.sm,
                                                    color: tokens.colors.textPrimary,
                                                    lineHeight: 1.5,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontWeight: 600,
                                                    }}
                                                >
                                                    {actorName}
                                                </span>{" "}
                                                <span
                                                    style={{
                                                        color: tokens.colors.textSecondary,
                                                    }}
                                                >
                                                    {verb}
                                                </span>{" "}
                                                <span
                                                    style={{
                                                        fontWeight: 500,
                                                        color: tokens.colors.textPrimary,
                                                    }}
                                                >
                                                    {entry.context.taskName ?? ""}
                                                </span>
                                            </div>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    fontSize: 11,
                                                    color: tokens.colors.textMuted,
                                                    marginTop: 2,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        display:
                                                            "inline-flex",
                                                        alignItems: "center",
                                                        gap: 4,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            width: 6,
                                                            height: 6,
                                                            borderRadius:
                                                                "50%",
                                                            background: color,
                                                        }}
                                                    />
                                                    {entry.action.replace(
                                                        /_/g,
                                                        " ",
                                                    )}
                                                </span>
                                                {entry.context.listName && (
                                                    <>
                                                        <span>·</span>
                                                        <span>
                                                            in{" "}
                                                            {entry.context.listName}
                                                        </span>
                                                    </>
                                                )}
                                                <span>·</span>
                                                <span>
                                                    {timeAgo(entry.createdAt)}
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Load more */}
                        {data?.hasMore && (
                            <div
                                style={{
                                    padding: tokens.spacing[3],
                                    textAlign: "center",
                                    borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                                }}
                            >
                                <Button
                                    type="text"
                                    onClick={() => setPage(page + 1)}
                                    loading={isLoading}
                                >
                                    Load {PAGE_SIZE} more · {entries.length}/
                                    {data?.total ?? 0}
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
};
