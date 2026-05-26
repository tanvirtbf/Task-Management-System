import { useState } from "react";
import { Popover, Input } from "antd";
import { Check, UserPlus } from "lucide-react";
import { users as allUsers } from "../../mocks/users";
import { Avatar } from "../ui/Avatar";
import { AssigneeStack } from "../ui/AssigneeStack";
import { tokens } from "../../theme";

interface InlineAssigneeEditProps {
    assigneeIds: string[];
    onChange: (next: string[]) => void;
    multiple?: boolean;
}

export const InlineAssigneeEdit = ({
    assigneeIds,
    onChange,
    multiple = true,
}: InlineAssigneeEditProps) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

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
