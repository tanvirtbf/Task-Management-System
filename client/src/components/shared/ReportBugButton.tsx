import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal, Input, Select, App as AntApp } from "antd";
import { Bug } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { engineeringApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { tokens } from "../../theme";

/**
 * Sidebar button visible to non-engineering teams. Opens a guided form that
 * creates a Bug task in the Engineering → Bug Triage list, assigned to the
 * on-call engineer for an S0/S1 and to the Engineering space head otherwise.
 * The server decides that; the form just sends the raw fields.
 */
/**
 * P3 of MOBILE_REBUILD_PLAN.md added the optional controlled mode. The trigger
 * lived only in the sidebar, which is not rendered on a phone — and a CS or
 * warehouse staffer holding a phone is exactly who files bugs. The mobile top
 * bar opens it from its menu instead. Called with no props (the desktop
 * sidebar) it behaves exactly as before and renders its own trigger.
 */
export const ReportBugButton = ({
    open: openProp,
    onOpenChange,
}: {
    open?: boolean;
    onOpenChange?: (next: boolean) => void;
} = {}) => {
    const [openLocal, setOpenLocal] = useState(false);
    const controlled = openProp !== undefined;
    const open = controlled ? openProp : openLocal;
    const setOpen = (next: boolean) =>
        controlled ? onOpenChange?.(next) : setOpenLocal(next);
    const [steps, setSteps] = useState("");
    const [happened, setHappened] = useState("");
    const [expected, setExpected] = useState("");
    const [team, setTeam] = useState<string | undefined>();
    const [severity, setSeverity] = useState<"S0" | "S1" | "S2" | "S3">("S2");
    const [url, setUrl] = useState("");

    const qc = useQueryClient();
    const navigate = useNavigate();
    const { message } = AntApp.useApp();

    const create = useMutation({
        // The backend composes the Bug task (Bug Triage list, reported status,
        // §29 SLA, and the routing that puts it on a real person) — the FE just
        // sends the raw fields; title/description are built server-side.
        mutationFn: () =>
            engineeringApi.reportBug({
                steps,
                happened,
                expected,
                severity,
                reporterTeam: team ?? "internal",
                url: url || undefined,
            }),
        onSuccess: (task) => {
            qc.invalidateQueries({
                queryKey: ["tasks-by-list", task.primaryListId],
            });
            // "created" left the reporter wondering whether anyone would see
            // it — and for a long time nobody did. Name the destination.
            // `task.id` is a 24-char internal handle — dumping it in a toast
            // reads as an error code, and custom_id is null on tasks the app
            // creates today. The user is being navigated to the task anyway, so
            // when there is no friendly id, name none.
            message.success(
                task.customId
                    ? `Bug ${task.customId} sent to Engineering`
                    : "Bug sent to Engineering",
            );
            setOpen(false);
            setSteps("");
            setHappened("");
            setExpected("");
            setUrl("");
            navigate(`/t/${task.customId ?? task.id}`);
        },
        // An AxiosError IS an Error, so the old `err.message` here showed
        // "Request failed with status code 409" — while the server was saying
        // something the reporter could act on, e.g. 'This workspace has no
        // "Bug Triage" list; create one before reporting bugs'. A person who
        // hits that reasonably concludes the feature is broken and stops
        // filing bugs. getApiErrorMessage reads the `{error:{code,message}}`
        // envelope and is what the rest of the app already uses.
        onError: (err) => message.error(getApiErrorMessage(err)),
    });

    return (
        <>
            {!controlled && (
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
            )}

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
                                    // This said `Auto: ${user.firstName}'s
                                    // team`, but nothing derives a team from
                                    // the user — leaving it blank submits
                                    // "internal", so a CS agent's bug arrived
                                    // in triage labelled as an internal one.
                                    // Say what actually happens instead.
                                    placeholder="Internal (default)"
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
