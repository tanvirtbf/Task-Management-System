import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal, Input, Select, Button, App as AntApp } from "antd";
import { Bug } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { currentOnCallEngineerId } from "../../mocks/on-call";
import { tokens } from "../../theme";

/**
 * Sidebar button visible to non-engineering teams. Opens a guided form
 * that creates a Bug task in the Engineering → Bug Triage list and
 * auto-assigns to the current on-call engineer.
 */
export const ReportBugButton = () => {
    const [open, setOpen] = useState(false);
    const [steps, setSteps] = useState("");
    const [happened, setHappened] = useState("");
    const [expected, setExpected] = useState("");
    const [team, setTeam] = useState<string | undefined>();
    const [severity, setSeverity] = useState<"S0" | "S1" | "S2" | "S3">("S2");
    const [url, setUrl] = useState("");

    const user = useAuthStore((s) => s.user);
    const qc = useQueryClient();
    const navigate = useNavigate();
    const { message } = AntApp.useApp();

    const create = useMutation({
        mutationFn: async () => {
            const title = steps.split("\n")[0]?.slice(0, 80) || "Bug report";
            const description = [
                "## Steps to reproduce",
                steps || "_not provided_",
                "",
                "## What happened",
                happened || "_not provided_",
                "",
                "## Expected behavior",
                expected || "_not provided_",
                url ? `\n## URL\n${url}` : "",
            ].join("\n");
            return mockApi.tasks.create({
                primaryListId: "l-bug-triage",
                name: title,
                taskTypeId: "tt-bug",
                description,
                statusId: "l-bug-triage-s-reported",
                assignees:
                    severity === "S0" || severity === "S1"
                        ? [currentOnCallEngineerId()]
                        : [],
                bugSeverity: severity,
                bugEnvironment: "production",
                bugReproducibility: "always",
                reporterTeam: (team as never) ?? "internal",
            });
        },
        onSuccess: (task) => {
            qc.invalidateQueries({
                queryKey: ["tasks-by-list", "l-bug-triage"],
            });
            message.success(`Bug ${task.customId ?? task.id} created`);
            setOpen(false);
            setSteps("");
            setHappened("");
            setExpected("");
            setUrl("");
            navigate(`/s/sp-eng/l/l-bug-triage?task=${task.id}`);
        },
        onError: () => message.error("Could not create bug"),
    });

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    padding: "6px 10px",
                    background: "transparent",
                    border: 0,
                    borderRadius: tokens.radius.sm,
                    color: tokens.colors.textPrimary,
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                }}
                onMouseEnter={(e) =>
                    (e.currentTarget.style.background = tokens.colors.bgHover)
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                }
            >
                <Bug
                    size={14}
                    strokeWidth={1.75}
                    color={tokens.colors.danger}
                />
                Report a bug
            </button>

            <Modal
                open={open}
                onCancel={() => setOpen(false)}
                title={
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <Bug size={16} strokeWidth={1.75} color={tokens.colors.danger} />
                        Report a bug to Engineering
                    </span>
                }
                width={580}
                okText="Submit"
                okButtonProps={{
                    loading: create.isPending,
                    disabled: !steps.trim() || !happened.trim(),
                }}
                onOk={() => create.mutate()}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[3],
                    }}
                >
                    <Field label="What did you do? (steps)" required>
                        <Input.TextArea
                            value={steps}
                            onChange={(e) => setSteps(e.target.value)}
                            autoSize={{ minRows: 3, maxRows: 6 }}
                            placeholder="1. Open product page&#10;2. Click 'Add to cart'&#10;3. Cart count stays at 0"
                        />
                    </Field>
                    <Field label="What happened?" required>
                        <Input.TextArea
                            value={happened}
                            onChange={(e) => setHappened(e.target.value)}
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            placeholder="Cart counter does not update"
                        />
                    </Field>
                    <Field label="What did you expect?">
                        <Input.TextArea
                            value={expected}
                            onChange={(e) => setExpected(e.target.value)}
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            placeholder="Cart counter increments to 1"
                        />
                    </Field>
                    <Field label="URL (if any)">
                        <Input
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://shop.beautybooth.com/p/..."
                        />
                    </Field>
                    <div style={{ display: "flex", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                            <Field label="Severity">
                                <Select
                                    value={severity}
                                    onChange={(v) => setSeverity(v)}
                                    style={{ width: "100%" }}
                                    options={[
                                        {
                                            value: "S0",
                                            label: "S0 — Critical (site down)",
                                        },
                                        { value: "S1", label: "S1 — Urgent" },
                                        { value: "S2", label: "S2 — Normal" },
                                        { value: "S3", label: "S3 — Minor" },
                                    ]}
                                />
                            </Field>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Field label="Your team">
                                <Select
                                    value={team}
                                    onChange={setTeam}
                                    style={{ width: "100%" }}
                                    placeholder={
                                        user
                                            ? `Auto: ${user.firstName}'s team`
                                            : "Select team"
                                    }
                                    options={[
                                        { value: "ops", label: "Operations" },
                                        { value: "cs", label: "Customer Support" },
                                        { value: "inventory", label: "Inventory" },
                                        { value: "listing", label: "Listing" },
                                        { value: "marketing", label: "Marketing" },
                                        { value: "internal", label: "Internal" },
                                    ]}
                                />
                            </Field>
                        </div>
                    </div>
                </div>
            </Modal>
        </>
    );
};

const Field = ({
    label,
    required,
    children,
}: {
    label: string;
    required?: boolean;
    children: React.ReactNode;
}) => (
    <div>
        <div
            style={{
                fontSize: 11,
                fontWeight: 600,
                color: tokens.colors.textSecondary,
                marginBottom: 4,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
            }}
        >
            {label}
            {required && (
                <span style={{ color: tokens.colors.danger, marginLeft: 3 }}>
                    *
                </span>
            )}
        </div>
        {children}
    </div>
);
