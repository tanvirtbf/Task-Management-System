import { useState } from "react";
import { Popover, Input } from "antd";
import { Check, Tag as TagIcon } from "lucide-react";
import { tagsBySpace, tagsById } from "../../mocks/tags";
import { TagChip } from "../ui/TagChip";
import { tokens } from "../../theme";

interface InlineTagEditProps {
    spaceId: string;
    tagIds: string[];
    onChange: (next: string[]) => void;
}

export const InlineTagEdit = ({
    spaceId,
    tagIds,
    onChange,
}: InlineTagEditProps) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const available = tagsBySpace(spaceId);
    const filtered = available.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase()),
    );

    const toggle = (id: string) => {
        if (tagIds.includes(id)) {
            onChange(tagIds.filter((x) => x !== id));
        } else {
            onChange([...tagIds, id]);
        }
    };

    const activeTags = tagIds
        .map((id) => tagsById.get(id))
        .filter((t): t is NonNullable<typeof t> => !!t);

    const content = (
        <div
            style={{ width: 220 }}
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
                    placeholder="Search or create..."
                    autoFocus
                    size="small"
                />
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto", padding: 4 }}>
                {filtered.map((t) => {
                    const isSelected = tagIds.includes(t.id);
                    return (
                        <button
                            key={t.id}
                            onClick={() => toggle(t.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 8,
                                padding: "6px 8px",
                                background: "none",
                                border: 0,
                                borderRadius: tokens.radius.sm,
                                cursor: "pointer",
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
                            <TagChip tag={t} size="sm" />
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
                            padding: 12,
                            textAlign: "center",
                            color: tokens.colors.textMuted,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        No tags found
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
                    padding: "2px 4px",
                    margin: "-2px -4px",
                    borderRadius: tokens.radius.sm,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    flexWrap: "wrap",
                    maxWidth: 200,
                    transition: "background var(--transition-base)",
                }}
                onMouseEnter={(e) =>
                    (e.currentTarget.style.background = tokens.colors.bgHover)
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                }
            >
                {activeTags.length > 0 ? (
                    activeTags.slice(0, 3).map((t) => (
                        <TagChip key={t.id} tag={t} size="sm" />
                    ))
                ) : (
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            color: tokens.colors.textMuted,
                            fontSize: 11,
                        }}
                    >
                        <TagIcon size={11} strokeWidth={1.5} />
                        Add tag
                    </span>
                )}
                {activeTags.length > 3 && (
                    <span
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        +{activeTags.length - 3}
                    </span>
                )}
            </button>
        </Popover>
    );
};
