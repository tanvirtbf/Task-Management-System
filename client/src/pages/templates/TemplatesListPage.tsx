import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Button,
    Input,
    Empty,
    Tag,
} from "antd";
import { Search, Library, Eye, ArrowDownToLine } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { LoadingState } from "../../components/shared/LoadingState";
import type { Template, TemplateType } from "../../types/template";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { TemplateApplyModal } from "./TemplateApplyModal";
import { tokens } from "../../theme";

const TYPE_FILTERS: Array<{ value: "all" | TemplateType; label: string }> = [
    { value: "all", label: "All" },
    { value: "task", label: "Tasks" },
    { value: "list", label: "Lists" },
    { value: "checklist", label: "Checklists" },
    { value: "form", label: "Forms" },
    { value: "view", label: "Views" },
    { value: "folder", label: "Folders" },
    { value: "space", label: "Spaces" },
];

const TemplatesListPage = () => {
    const [filter, setFilter] = useState<"all" | TemplateType>("all");
    const [query, setQuery] = useState("");
    const [applyTarget, setApplyTarget] = useState<Template | null>(null);

    const { data: templates = [], isLoading } = useQuery({
        queryKey: ["templates"],
        queryFn: () => mockApi.templates.list(),
    });

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return templates.filter((t) => {
            if (filter !== "all" && t.type !== filter) return false;
            if (q && !t.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [templates, filter, query]);

    const counts = useMemo(() => {
        const out: Record<string, number> = { all: templates.length };
        templates.forEach((t) => {
            out[t.type] = (out[t.type] ?? 0) + 1;
        });
        return out;
    }, [templates]);

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1200,
                margin: "0 auto",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                    marginBottom: tokens.spacing[5],
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: tokens.radius.lg,
                        background: tokens.colors.primarySubtle,
                        color: tokens.colors.primary,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Library size={22} strokeWidth={1.75} />
                </div>
                <div style={{ flex: 1 }}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["3xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                        }}
                    >
                        Templates
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        Reusable blueprints — apply to bootstrap tasks, lists,
                        forms, or views.
                    </p>
                </div>
                <Input
                    prefix={
                        <Search
                            size={13}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    }
                    placeholder="Search templates..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ width: 280 }}
                />
            </div>

            {/* Type filter chips */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: tokens.spacing[4],
                }}
            >
                {TYPE_FILTERS.map((f) => {
                    const active = filter === f.value;
                    const count = counts[f.value] ?? 0;
                    return (
                        <button
                            key={f.value}
                            onClick={() => setFilter(f.value)}
                            style={chipStyle(active)}
                        >
                            {f.label}
                            <span
                                style={{
                                    fontSize: 10,
                                    color: active
                                        ? "rgba(255,255,255,0.7)"
                                        : tokens.colors.textMuted,
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                }}
                            >
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Grid */}
            {isLoading ? (
                <LoadingState />
            ) : filtered.length === 0 ? (
                <Empty description="No templates match your filters." />
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns:
                            "repeat(auto-fill, minmax(280px, 1fr))",
                        gap: tokens.spacing[3],
                    }}
                >
                    {filtered.map((t) => (
                        <TemplateCard
                            key={t.id}
                            template={t}
                            onApply={() => setApplyTarget(t)}
                        />
                    ))}
                </div>
            )}

            {applyTarget && (
                <TemplateApplyModal
                    template={applyTarget}
                    onClose={() => setApplyTarget(null)}
                />
            )}
        </div>
    );
};

const TemplateCard = ({
    template,
    onApply,
}: {
    template: Template;
    onApply: () => void;
}) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[4],
            display: "flex",
            flexDirection: "column",
            gap: tokens.spacing[3],
            transition: "all var(--transition-base)",
            cursor: "default",
        }}
        onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = template.color;
            e.currentTarget.style.boxShadow = tokens.shadows.md;
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = tokens.colors.border;
            e.currentTarget.style.boxShadow = "none";
        }}
    >
        <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: tokens.spacing[3],
            }}
        >
            <div
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: tokens.radius.md,
                    background: `${template.color}1A`,
                    color: template.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}
            >
                <DynamicIcon
                    name={template.icon}
                    size={20}
                    strokeWidth={1.75}
                />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                    }}
                >
                    <h3
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize.base,
                            fontWeight: 600,
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        {template.name}
                    </h3>
                </div>
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: tokens.colors.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                    }}
                >
                    {template.type}
                </span>
            </div>
        </div>

        <p
            style={{
                margin: 0,
                fontSize: tokens.typography.fontSize.sm,
                color: tokens.colors.textSecondary,
                lineHeight: 1.5,
                minHeight: 40,
            }}
        >
            {template.description}
        </p>

        {template.tags && template.tags.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {template.tags.map((tag) => (
                    <Tag
                        key={tag}
                        style={{
                            margin: 0,
                            fontSize: 10,
                            padding: "0 6px",
                            lineHeight: "18px",
                            borderRadius: 4,
                        }}
                    >
                        {tag}
                    </Tag>
                ))}
            </div>
        )}

        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: 6,
                borderTop: `1px dashed ${tokens.colors.borderSubtle}`,
            }}
        >
            <span
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                Used {template.usageCount}× · {template.sharing}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
                <Button
                    size="small"
                    type="text"
                    icon={<Eye size={12} strokeWidth={1.75} />}
                >
                    Preview
                </Button>
                <Button
                    size="small"
                    type="primary"
                    icon={<ArrowDownToLine size={12} strokeWidth={1.75} />}
                    onClick={onApply}
                >
                    Apply
                </Button>
            </div>
        </div>
    </div>
);

const chipStyle = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 11px",
    background: active ? tokens.colors.primary : tokens.colors.bgSurface,
    border: `1px solid ${active ? tokens.colors.primary : tokens.colors.border}`,
    borderRadius: tokens.radius.full,
    color: active ? "#fff" : tokens.colors.textPrimary,
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    transition: "all var(--transition-fast)",
});

export default TemplatesListPage;
