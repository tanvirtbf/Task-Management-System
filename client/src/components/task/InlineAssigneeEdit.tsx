import { useMemo, useState } from "react";
import { Popover, Input } from "antd";
import { Check, UserPlus } from "lucide-react";
import type { User } from "../../types";
import { useUsers } from "../../hooks/useReferenceData";
import { useAssignablePeople } from "../../hooks/useAssignablePeople";
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

    // The avatar stack must show whoever is ON the task, even a leaver who was
    // assigned before they were deactivated — so it reads the unfiltered list.
    // Only the OPTIONS below are restricted to people the server will accept.
    const { data: allUsers = [] } = useUsers();
    const assignees = allUsers.filter((u) => assigneeIds.includes(u.id));

    const { me, myTeam, others, teamInfo } = useAssignablePeople(open);

    const q = search.trim().toLowerCase();
    const matches = (u: User) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        // The email is printed on every row, so it should be searchable —
        // people reach for the part of a name they can actually remember.
        u.email.toLowerCase().includes(q);

    const shownTeam = useMemo(
        () => (q ? myTeam.filter(matches) : myTeam),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [myTeam, q],
    );
    const shownOthers = useMemo(
        () => (q ? others.filter(matches) : others),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [others, q],
    );
    const nothingFound = shownTeam.length === 0 && shownOthers.length === 0;

    const toggle = (id: string) => {
        if (assigneeIds.includes(id)) {
            onChange(assigneeIds.filter((x) => x !== id));
        } else {
            onChange(multiple ? [...assigneeIds, id] : [id]);
            if (!multiple) setOpen(false);
        }
    };

    const iAmAssigned = !!me && assigneeIds.includes(me.id);

    const renderPerson = (u: User) => {
        const isSelected = assigneeIds.includes(u.id);
        const info = teamInfo.get(u.id);
        // Q11 mirror: not a member of the owning space, and not an
        // admin/owner (their reach is never gated).
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
                    (e.currentTarget.style.background = tokens.colors.bgHover)
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
                                    color: tokens.colors.textMuted,
                                    background: tokens.colors.bgPage,
                                    border: `1px solid ${tokens.colors.borderSubtle}`,
                                    borderRadius: tokens.radius.full,
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
                            fontFamily: tokens.typography.fontFamilyMono,
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
    };

    const content = (
        <div style={{ width: 260 }} onClick={(e) => e.stopPropagation()}>
            {/* Taking a task yourself is the most common assignment there is,
                and it used to cost the same search as picking anyone else.
                Pinned ABOVE the search box, so it never moves and never has to
                be typed for. */}
            {me && (
                <button
                    onClick={() => toggle(me.id)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "8px 10px",
                        background: iAmAssigned
                            ? tokens.colors.bgHover
                            : "none",
                        border: 0,
                        borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                        cursor: "pointer",
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                        textAlign: "left",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                            tokens.colors.bgHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = iAmAssigned
                            ? tokens.colors.bgHover
                            : "transparent")
                    }
                >
                    <Avatar
                        name={`${me.firstName} ${me.lastName}`}
                        src={me.avatarUrl}
                        size={22}
                    />
                    <span style={{ flex: 1 }}>
                        {iAmAssigned ? "Assigned to me" : "Assign to me"}
                    </span>
                    {iAmAssigned && (
                        <Check
                            size={14}
                            strokeWidth={2.25}
                            color={tokens.colors.primary}
                        />
                    )}
                </button>
            )}

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
            <div style={{ maxHeight: 280, overflowY: "auto", padding: 4 }}>
                {/* Headings only when there is something on both sides of the
                    split — a lone "EVERYONE ELSE" over the whole list would be
                    noise, and during a search a flat list of hits reads
                    better than two sections of one row each. */}
                {shownTeam.length > 0 && shownOthers.length > 0 && (
                    <SectionLabel>Your team</SectionLabel>
                )}
                {shownTeam.map(renderPerson)}
                {shownTeam.length > 0 && shownOthers.length > 0 && (
                    <SectionLabel>Everyone else</SectionLabel>
                )}
                {shownOthers.map(renderPerson)}
                {nothingFound && (
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

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div
        style={{
            padding: "6px 8px 2px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: tokens.colors.textMuted,
        }}
    >
        {children}
    </div>
);
