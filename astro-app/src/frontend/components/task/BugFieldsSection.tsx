import { Select, Input } from "antd";
import { Bug } from "lucide-react";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import type { Task } from "../../types";
import { SEVERITY_META } from "../../types/sprint";
import { tokens } from "../../theme";

const REPRO_OPTIONS = [
    { value: "always", label: "Always" },
    { value: "sometimes", label: "Sometimes" },
    { value: "once", label: "Once" },
    { value: "cannot", label: "Cannot reproduce" },
];

const ENV_OPTIONS = [
    { value: "production", label: "Production" },
    { value: "staging", label: "Staging" },
    { value: "local", label: "Local" },
];

const REPORTER_OPTIONS = [
    { value: "ops", label: "Operations" },
    { value: "cs", label: "Customer Support" },
    { value: "inventory", label: "Inventory" },
    { value: "listing", label: "Product Listing" },
    { value: "marketing", label: "Marketing" },
    { value: "internal", label: "Internal / Dev" },
];

export const BugFieldsSection = ({ task }: { task: Task }) => {
    const update = useUpdateTask(task.primaryListId);

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: tokens.spacing[3],
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                }}
            >
                <Bug size={11} strokeWidth={1.75} />
                Bug details
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr",
                    rowGap: tokens.spacing[2],
                    columnGap: tokens.spacing[3],
                    fontSize: tokens.typography.fontSize.sm,
                }}
            >
                <Label>Severity</Label>
                <Select
                    size="small"
                    value={task.bugSeverity ?? undefined}
                    placeholder="Set severity"
                    style={{ width: "100%" }}
                    options={(Object.keys(SEVERITY_META) as Array<keyof typeof SEVERITY_META>).map(
                        (s) => ({ value: s, label: SEVERITY_META[s].label }),
                    )}
                    onChange={(v) =>
                        update.mutate({
                            id: task.id,
                            patch: { bugSeverity: v as Task["bugSeverity"] },
                        })
                    }
                    allowClear
                />

                <Label>Reproducibility</Label>
                <Select
                    size="small"
                    value={task.bugReproducibility ?? undefined}
                    placeholder="How often?"
                    style={{ width: "100%" }}
                    options={REPRO_OPTIONS}
                    onChange={(v) =>
                        update.mutate({
                            id: task.id,
                            patch: {
                                bugReproducibility:
                                    v as Task["bugReproducibility"],
                            },
                        })
                    }
                    allowClear
                />

                <Label>Environment</Label>
                <Select
                    size="small"
                    value={task.bugEnvironment ?? undefined}
                    placeholder="Where?"
                    style={{ width: "100%" }}
                    options={ENV_OPTIONS}
                    onChange={(v) =>
                        update.mutate({
                            id: task.id,
                            patch: {
                                bugEnvironment: v as Task["bugEnvironment"],
                            },
                        })
                    }
                    allowClear
                />

                <Label>Browser/OS</Label>
                <Input
                    size="small"
                    value={task.bugBrowser ?? ""}
                    placeholder="Chrome 120 / Windows"
                    onChange={(e) =>
                        update.mutate({
                            id: task.id,
                            patch: { bugBrowser: e.target.value },
                        })
                    }
                />

                <Label>Reporter</Label>
                <Select
                    size="small"
                    value={task.reporterTeam ?? undefined}
                    placeholder="Reporting team"
                    style={{ width: "100%" }}
                    options={REPORTER_OPTIONS}
                    onChange={(v) =>
                        update.mutate({
                            id: task.id,
                            patch: {
                                reporterTeam: v as Task["reporterTeam"],
                            },
                        })
                    }
                    allowClear
                />
            </div>
        </div>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
    <div
        style={{
            color: tokens.colors.textMuted,
            fontWeight: 500,
            paddingTop: 5,
        }}
    >
        {children}
    </div>
);
