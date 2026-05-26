import { useState, useEffect } from "react";
import { Drawer, Input, Select, Slider, Switch, Button } from "antd";
import { Save } from "lucide-react";
import type { DashboardWidget, WidgetScope } from "../../types/dashboard";
import { spaces as allSpaces } from "../../mocks/spaces";
import { lists as allLists } from "../../mocks/lists";
import { spacesById } from "../../mocks/spaces";
import { tokens } from "../../theme";

interface Props {
    widget: DashboardWidget;
    onSave: (patch: Partial<DashboardWidget>) => void;
    onClose: () => void;
}

export const WidgetEditor = ({ widget, onSave, onClose }: Props) => {
    const [draft, setDraft] = useState<DashboardWidget>(widget);

    useEffect(() => {
        setDraft(widget);
    }, [widget]);

    const update = (patch: Partial<DashboardWidget>) =>
        setDraft({ ...draft, ...patch });
    const updateConfig = (patch: Partial<DashboardWidget["config"]>) =>
        setDraft({ ...draft, config: { ...draft.config, ...patch } });

    const handleScopeChange = (
        scopeType: WidgetScope["type"],
        scopeId?: string,
    ) => {
        const scope: WidgetScope =
            scopeType === "workspace"
                ? { type: "workspace" }
                : scopeType === "space"
                  ? { type: "space", id: scopeId ?? allSpaces[0].id }
                  : { type: "list", id: scopeId ?? allLists[0].id };
        updateConfig({ scope });
    };

    const showMetric = draft.type !== "text" && draft.type !== "calendar_heatmap";
    const showGroupBy =
        draft.type === "bar_chart" || draft.type === "donut_chart";
    const showTimeRange =
        draft.type === "line_chart" ||
        draft.type === "kpi" ||
        draft.type === "calendar_heatmap";
    const showSortBy = draft.type === "task_list";
    const showLimit =
        draft.type === "task_list" ||
        draft.type === "workload" ||
        draft.type === "activity_feed";
    const showLegend = draft.type === "donut_chart";
    const showCompareTo = draft.type === "kpi";
    const showColor =
        draft.type === "kpi" ||
        draft.type === "bar_chart" ||
        draft.type === "line_chart" ||
        draft.type === "calendar_heatmap";
    const showBody = draft.type === "text";

    return (
        <Drawer
            open
            onClose={onClose}
            width={420}
            title={`Edit “${widget.title}”`}
            footer={
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button
                        type="primary"
                        icon={<Save size={14} strokeWidth={1.75} />}
                        onClick={() => onSave(draft)}
                    >
                        Save widget
                    </Button>
                </div>
            }
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                }}
            >
                <Field label="Title">
                    <Input
                        value={draft.title}
                        onChange={(e) => update({ title: e.target.value })}
                    />
                </Field>

                <Field label={`Column span (${draft.colSpan} of 12)`}>
                    <Slider
                        min={2}
                        max={12}
                        step={1}
                        value={draft.colSpan}
                        onChange={(v) => update({ colSpan: v })}
                        marks={{ 2: "2", 6: "6", 12: "12" }}
                    />
                </Field>

                <Field label={`Row height (${draft.rowSpan})`}>
                    <Slider
                        min={1}
                        max={3}
                        step={1}
                        value={draft.rowSpan}
                        onChange={(v) => update({ rowSpan: v })}
                        marks={{ 1: "Short", 2: "Medium", 3: "Tall" }}
                    />
                </Field>

                <Divider label="Data" />

                {!showBody && (
                    <>
                        <Field label="Scope">
                            <Select
                                value={draft.config.scope?.type ?? "workspace"}
                                onChange={(v) => handleScopeChange(v)}
                                style={{ width: "100%" }}
                                options={[
                                    { value: "workspace", label: "Whole workspace" },
                                    { value: "space", label: "A space" },
                                    { value: "list", label: "A list" },
                                ]}
                            />
                        </Field>

                        {draft.config.scope?.type === "space" && (
                            <Field label="Space">
                                <Select
                                    value={draft.config.scope.id}
                                    onChange={(v) =>
                                        handleScopeChange("space", v)
                                    }
                                    style={{ width: "100%" }}
                                    options={allSpaces.map((s) => ({
                                        value: s.id,
                                        label: s.name,
                                    }))}
                                />
                            </Field>
                        )}

                        {draft.config.scope?.type === "list" && (
                            <Field label="List">
                                <Select
                                    value={draft.config.scope.id}
                                    onChange={(v) =>
                                        handleScopeChange("list", v)
                                    }
                                    style={{ width: "100%" }}
                                    showSearch
                                    optionFilterProp="label"
                                    options={allLists.map((l) => {
                                        const sp = spacesById.get(l.spaceId);
                                        return {
                                            value: l.id,
                                            label: `${sp?.name} / ${l.name}`,
                                        };
                                    })}
                                />
                            </Field>
                        )}
                    </>
                )}

                {showMetric && (
                    <Field label="Metric">
                        <Select
                            value={draft.config.metric ?? "task_count"}
                            onChange={(v) => updateConfig({ metric: v })}
                            style={{ width: "100%" }}
                            options={[
                                { value: "task_count", label: "Open task count" },
                                { value: "task_count_completed", label: "Completed task count" },
                                { value: "task_count_overdue", label: "Overdue task count" },
                                { value: "task_count_due_today", label: "Due today" },
                                { value: "task_count_due_this_week", label: "Due this week" },
                                { value: "comment_count", label: "Comment count" },
                                { value: "time_tracked", label: "Time tracked (sec)" },
                            ]}
                        />
                    </Field>
                )}

                {showGroupBy && (
                    <Field label="Group by">
                        <Select
                            value={draft.config.groupBy ?? "status"}
                            onChange={(v) => updateConfig({ groupBy: v })}
                            style={{ width: "100%" }}
                            options={[
                                { value: "status", label: "Status" },
                                { value: "priority", label: "Priority" },
                                { value: "assignee", label: "Assignee" },
                                { value: "list", label: "List" },
                                { value: "task_type", label: "Task type" },
                                { value: "tag", label: "Tag" },
                            ]}
                        />
                    </Field>
                )}

                {showTimeRange && (
                    <Field label="Time range">
                        <Select
                            value={draft.config.timeRange ?? "30d"}
                            onChange={(v) => updateConfig({ timeRange: v })}
                            style={{ width: "100%" }}
                            options={[
                                { value: "today", label: "Today" },
                                { value: "7d", label: "Last 7 days" },
                                { value: "30d", label: "Last 30 days" },
                                { value: "90d", label: "Last 90 days" },
                                { value: "all", label: "All time" },
                            ]}
                        />
                    </Field>
                )}

                {showSortBy && (
                    <Field label="Sort by">
                        <Select
                            value={draft.config.sortBy ?? "priority"}
                            onChange={(v) => updateConfig({ sortBy: v })}
                            style={{ width: "100%" }}
                            options={[
                                { value: "priority", label: "Priority" },
                                { value: "due_date", label: "Due date" },
                                { value: "updated_at", label: "Recently updated" },
                                { value: "created_at", label: "Recently created" },
                            ]}
                        />
                    </Field>
                )}

                {showLimit && (
                    <Field label={`Max rows (${draft.config.limit ?? 8})`}>
                        <Slider
                            min={3}
                            max={20}
                            step={1}
                            value={draft.config.limit ?? 8}
                            onChange={(v) => updateConfig({ limit: v })}
                            marks={{ 3: "3", 10: "10", 20: "20" }}
                        />
                    </Field>
                )}

                {showCompareTo && (
                    <Field label="Show trend vs previous period">
                        <Switch
                            checked={
                                draft.config.kpiCompareTo === "prev_period"
                            }
                            onChange={(v) =>
                                updateConfig({
                                    kpiCompareTo: v ? "prev_period" : undefined,
                                })
                            }
                        />
                    </Field>
                )}

                {showLegend && (
                    <Field label="Show legend">
                        <Switch
                            checked={draft.config.showLegend ?? true}
                            onChange={(v) =>
                                updateConfig({ showLegend: v })
                            }
                        />
                    </Field>
                )}

                {showColor && (
                    <Field label="Accent color">
                        <Select
                            value={draft.config.chartColor ?? "#4F46E5"}
                            onChange={(v) =>
                                updateConfig({ chartColor: v })
                            }
                            style={{ width: "100%" }}
                            options={COLORS.map((c) => ({
                                value: c.value,
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
                                                width: 10,
                                                height: 10,
                                                borderRadius: 2,
                                                background: c.value,
                                            }}
                                        />
                                        {c.label}
                                    </span>
                                ),
                            }))}
                        />
                    </Field>
                )}

                {showBody && (
                    <Field label="Markdown body">
                        <Input.TextArea
                            value={
                                (draft.config.bodyMarkdown as string) ?? ""
                            }
                            onChange={(e) =>
                                updateConfig({
                                    bodyMarkdown: e.target.value,
                                })
                            }
                            autoSize={{ minRows: 6, maxRows: 16 }}
                            style={{
                                fontFamily:
                                    tokens.typography.fontFamilyMono,
                                fontSize: 12,
                            }}
                        />
                    </Field>
                )}
            </div>
        </Drawer>
    );
};

const COLORS = [
    { value: "#4F46E5", label: "Indigo" },
    { value: "#10B981", label: "Green" },
    { value: "#F59E0B", label: "Amber" },
    { value: "#E11D48", label: "Rose" },
    { value: "#8B5CF6", label: "Violet" },
    { value: "#06B6D4", label: "Cyan" },
    { value: "#EC4899", label: "Pink" },
    { value: "#64748B", label: "Slate" },
];

const Field = ({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) => (
    <div>
        <label
            style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: tokens.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
            }}
        >
            {label}
        </label>
        {children}
    </div>
);

const Divider = ({ label }: { label: string }) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "4px 0",
        }}
    >
        <span
            style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: tokens.colors.textPrimary,
                textTransform: "uppercase",
            }}
        >
            {label}
        </span>
        <div
            style={{
                flex: 1,
                height: 1,
                background: tokens.colors.borderSubtle,
            }}
        />
    </div>
);
