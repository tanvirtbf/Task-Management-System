import { useMemo, useState } from "react";
import { Popover, Input } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Check, UserPlus } from "lucide-react";
import { useUsers } from "../../hooks/useReferenceData";
import { teamsApi } from "../../http/api";
import { Avatar } from "../ui/Avatar";
import { AssigneeStack } from "../ui/AssigneeStack";
import { tokens } from "../../theme";

interface InlineAssigneeEditProps {
    assigneeIds: string[];
    onChange: (next: string[]) => void;
    multiple?: boolean;
    /**
     * Team-access P9: the space that OWNS the task being edited. When set,
     * each option shows the person's team, and a pick that is not a member
     * of this space warns "needs approval" BEFORE you commit (Q11 — the
     * server still decides; admins/owners are never gated).
     */
    taskSpaceId?: string | null;
}

export const InlineAssigneeEdit = ({
    assigneeIds,
    onChange,
    multiple = true,
    taskSpaceId = null,
}: InlineAssigneeEditProps) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const { data: allUsers = [] } = useUsers();
    // Shared cache with TeamsSettings / the approval hooks (["teams"]).
    const { data: directory } = useQuery({
        queryKey: ["teams"],
        queryFn: teamsApi.directory,
        staleTime: 60_000,
        enabled: open,
    });

    // Per person: their team names + membership set (Q11's question).
    const teamInfo = useMemo(() => {
        const info = new Map<
            string,
            { label: string; spaceIds: Set<string> }
        >();
        for (const t of directory?.teams ?? []) {
            for (const m of t.members) {
                const cur = info.get(m.user.id) ?? {
                    label: "",
                    spaceIds: new Set<string>(),
                };
                cur.spaceIds.add(t.space.id);
                if (m.isPrimary || !cur.label) cur.label = t.space.name;
                info.set(m.user.id, cur);
            }
        }
        return info;
    }, [directory]);
    const assignees = allUsers.filter((u) => assigneeIds.includes(u.id));
    const filtered = allUsers.filter((u) =>
        `${u.firstName} ${u.lastName}`
            .toLowerCase()
            .includes(search.toLowerCase()),
    );

    const toggle = (id: string) => {
        if (assigneeIds.includes(id)) {
            onChange(assigneeIds.filter((x) => x !== id));
        } else {
            onChange(multiple ? [...assigneeIds, id] : [id]);
            if (!multiple) setOpen(false);
        }
    };

    const content = (
        <div
            style={{ width: 260 }}
            onClick={(e) => e.stopPropagation()}
        >
            <div
                style={{
                    padding: "8px 8px 4px",
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                }}
            >
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search people..."
                    autoFocus
                    size="small"
                />
            </div>
            <div
                style={{
                    maxHeight: 280,
                    overflowY: "auto",
                    padding: 4,
                }}
            >
                {filtered.map((u) => {
                    const isSelected = assigneeIds.includes(u.id);
                    const info = teamInfo.get(u.id);
                    // Q11 mirror: not a member of the owning space, and not
                    // an admin/owner (their reach is never gated).
                    const needsApproval =
                        !!taskSpaceId &&
                        u.role !== "owner" &&
                        u.role !== "admin" &&
                        !(info?.spaceIds.has(taskSpaceId) ?? false);
                    return (
                        <button
                            key={u.id}
                            onClick={() => toggle(u.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 8px",
                                background: "none",
                                border: 0,
                                borderRadius: tokens.radius.sm,
                                cursor: "pointer",
                                fontSize: tokens.typography.fontSize.sm,
                                textAlign: "left",
                                width: "100%",
                            }}
                            onMouseEnter={(e) =>
                                (e.currentTarget.style.background =
                                    tokens.colors.bgHover)
                            }
                            onMouseLeave={(e) =>
                                (e.currentTarget.style.background = "transparent")
                            }
                        >
                            <Avatar
                                name={`${u.firstName} ${u.lastName}`}
                                src={u.avatarUrl}
                                size={22}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                    style={{
                                        fontWeight: 500,
                                        color: tokens.colors.textPrimary,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {u.firstName} {u.lastName}
                                    {info?.label && (
                                        <span
                                            style={{
                                                marginLeft: 6,
                                                fontSize: 10,
                                                fontWeight: 600,
                                                color: tokens.colors
                                                    .textMuted,
                                                background:
                                                    tokens.colors.bgPage,
                                                border: `1px solid ${tokens.colors.borderSubtle}`,
                                                borderRadius:
                                                    tokens.radius.full,
                                                padding: "0 6px",
                                            }}
                                        >
                                            {info.label}
                                        </span>
                                    )}
                                </div>
                                <div
                                    style={{
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                    }}
                                >
                                    {u.email}
                                </div>
                                {needsApproval && !isSelected && (
                                    <div
                                        style={{
                                            fontSize: 10,
                                            fontWeight: 600,
                                            color: "#92400E",
                                            marginTop: 1,
                                        }}
                                    >
                                        {info?.label
                                            ? `Cross-team — will need ${info.label}'s approval`
                                            : "Cross-team — will need their approval"}
                                    </div>
                                )}
                            </div>
                            {isSelected && (
                                <Check
                                    size={14}
                                    strokeWidth={2.25}
                                    color={tokens.colors.primary}
                                />
                            )}
                        </button>
                    );
                })}
                {filtered.length === 0 && (
                    <div
                        style={{
                            padding: 16,
                            textAlign: "center",
                            color: tokens.colors.textMuted,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        No people found
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <Popover
            content={content}
            trigger={["click"]}
            open={open}
            onOpenChange={setOpen}
            placement="bottomLeft"
            overlayInnerStyle={{ padding: 0 }}
        >
            <button
                aria-label="Edit assignees"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(!open);
                }}
                style={{
                    background: "none",
                    border: 0,
                    padding: 2,
                    margin: -2,
                    borderRadius: tokens.radius.sm,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    transition: "background var(--transition-base)",
                }}
                onMouseEnter={(e) =>
                    (e.currentTarget.style.background = tokens.colors.bgHover)
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                }
            >
                {assignees.length > 0 ? (
                    <AssigneeStack users={assignees} size={20} max={3} />
                ) : (
                    <UserPlus
                        size={14}
                        strokeWidth={1.5}
                        color={tokens.colors.textMuted}
                    />
                )}
            </button>
        </Popover>
    );
};
