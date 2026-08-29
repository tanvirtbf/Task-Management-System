import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Alert, Button, DatePicker, Input, InputNumber, Select } from "antd";
import { isValidBdPhone } from "../../lib/bd-phone";
import { useIsMobile } from "../../hooks/useIsMobile";
import dayjs from "dayjs";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { publicFormsApi, type PublicFormField } from "../../http/api";
import { Logo } from "../../components/ui/Logo";
import { tokens } from "../../theme";

/**
 * Anonymous public form (§18, `GET/POST /public/forms/:slug`). The public
 * projection now carries each custom field's `valueType` (+ dropdown `options`
 * and a curated `config`), so every field renders its proper control and
 * submits the matching value envelope:
 *   task_attr  → raw string         | text/phone → { text }
 *   date       → { date: ISO }       | dropdown   → { option_id }
 *   money      → { amount, currency } | files     → unsupported anonymously
 */
const PublicFormPage = () => {
    const { slug } = useParams();
    // Must sit with the other hooks: the early returns below (loading, not
    // found) would otherwise make the hook count vary between renders.
    const isMobile = useIsMobile();
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);

    const { data: form, isLoading } = useQuery({
        queryKey: ["public-form", slug],
        queryFn: () =>
            slug ? publicFormsApi.getBySlug(slug) : Promise.resolve(null),
        enabled: !!slug,
    });

    const fields = useMemo(
        () =>
            (form?.fields ?? [])
                .slice()
                .sort((a, b) => a.position - b.position),
        [form],
    );

    const submit = useMutation({
        mutationFn: () => {
            const data: Record<string, unknown> = {};
            for (const f of fields) {
                const v = values[f.fieldKey];
                if (v === undefined || v === null || v === "") continue;
                data[f.fieldKey] = toEnvelope(f, v);
            }
            return publicFormsApi.submit(slug!, data);
        },
        onSuccess: () => setSubmitted(true),
    });

    if (isLoading) return <CenteredMessage>Loading form…</CenteredMessage>;
    if (!form) {
        return (
            <CenteredMessage>
                <div
                    style={{
                        textAlign: "center",
                        color: tokens.colors.textMuted,
                    }}
                >
                    <AlertCircle
                        size={32}
                        strokeWidth={1.5}
                        style={{ marginBottom: 8 }}
                    />
                    <div>Form not found.</div>
                </div>
            </CenteredMessage>
        );
    }

    const branding = (form.branding ?? {}) as {
        primaryColor?: string;
        hideAppBranding?: boolean;
    };
    const primaryColor = branding.primaryColor ?? tokens.colors.primary;

    const handleSubmit = () => {
        const newErrors: Record<string, string> = {};
        for (const f of fields) {
            // `files` can't be filled anonymously — don't block on it.
            if (f.valueType === "files") continue;
            const v = values[f.fieldKey];
            if (f.isRequired && (v === undefined || v === null || v === "")) {
                newErrors[f.fieldKey] = "This field is required";
                continue;
            }
            if (f.valueType === "phone" && typeof v === "string" && v.trim() !== "" && !isValidBdPhone(v)) {
                newErrors[f.fieldKey] = "Use an 11-digit number like 01712345678";
            }
        }
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            // Without this the page does not move, so on a phone — where the
            // failing field is usually above the fold you are looking at —
            // Submit reads as a button that does nothing.
            const firstKey = fields.find((f) => newErrors[f.fieldKey])?.fieldKey;
            requestAnimationFrame(() => {
                const el = document.querySelector<HTMLElement>(
                    `[data-field-key="${firstKey}"]`,
                );
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
                el?.querySelector<HTMLElement>("input,textarea")?.focus();
            });
            return;
        }
        setErrors({});
        submit.mutate();
    };

    if (submitted) {
        return (
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: tokens.spacing[6],
                }}
            >
                <div
                    style={{
                        maxWidth: 480,
                        textAlign: "center",
                        background: tokens.colors.bgSurface,
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.xl,
                        padding: tokens.spacing[8],
                        boxShadow: tokens.shadows.md,
                    }}
                >
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            borderRadius: "50%",
                            background: tokens.colors.successSubtle,
                            color: tokens.colors.success,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "0 auto",
                            marginBottom: tokens.spacing[4],
                        }}
                    >
                        <CheckCircle2 size={32} strokeWidth={1.75} />
                    </div>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["2xl"],
                            fontWeight: 700,
                            color: tokens.colors.textPrimary,
                            marginBottom: tokens.spacing[2],
                        }}
                    >
                        Submission received
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            color: tokens.colors.textSecondary,
                            lineHeight: 1.6,
                        }}
                    >
                        {form.successMessage ??
                            "Thanks for your submission. We'll be in touch."}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                // 24 outside + 32 inside per side spent 112px of a 360px screen
                // on nothing — a third of a customer's phone.
                padding: isMobile ? tokens.spacing[3] : tokens.spacing[6],
            }}
        >
            <div
                style={{
                    maxWidth: 560,
                    width: "100%",
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.xl,
                    padding: isMobile ? tokens.spacing[4] : tokens.spacing[8],
                    boxShadow: tokens.shadows.md,
                    marginTop: isMobile ? tokens.spacing[3] : tokens.spacing[6],
                }}
            >
                {/* Brand accent */}
                <div
                    style={{
                        height: 4,
                        background: primaryColor,
                        marginBottom: tokens.spacing[6],
                        marginTop: -tokens.spacing[8],
                        marginLeft: -tokens.spacing[8],
                        marginRight: -tokens.spacing[8],
                        borderRadius: `${tokens.radius.xl}px ${tokens.radius.xl}px 0 0`,
                    }}
                />

                <h1
                    style={{
                        margin: 0,
                        fontSize: tokens.typography.fontSize["2xl"],
                        fontWeight: 700,
                        color: tokens.colors.textPrimary,
                        marginBottom: tokens.spacing[2],
                        letterSpacing: "-0.02em",
                    }}
                >
                    {form.title}
                </h1>
                {form.description && (
                    <p
                        style={{
                            margin: 0,
                            marginBottom: tokens.spacing[6],
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.base,
                            lineHeight: 1.6,
                        }}
                    >
                        {form.description}
                    </p>
                )}

                {submit.isError && (
                    <Alert
                        type="error"
                        message="Submission failed. Please check your answers and try again."
                        showIcon
                        style={{ marginBottom: tokens.spacing[3] }}
                    />
                )}

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[4],
                    }}
                >
                    {fields.map((field) => (
                        <FormFieldInput
                            key={field.fieldKey}
                            field={field}
                            value={values[field.fieldKey]}
                            error={errors[field.fieldKey]}
                            onChange={(v) => {
                                setValues((s) => ({
                                    ...s,
                                    [field.fieldKey]: v,
                                }));
                                if (errors[field.fieldKey]) {
                                    setErrors((e) => {
                                        const next = { ...e };
                                        delete next[field.fieldKey];
                                        return next;
                                    });
                                }
                            }}
                        />
                    ))}
                </div>

                <Button
                    type="primary"
                    size="large"
                    block
                    loading={submit.isPending}
                    onClick={handleSubmit}
                    style={{
                        marginTop: tokens.spacing[5],
                        background: primaryColor,
                        borderColor: primaryColor,
                    }}
                >
                    Submit
                </Button>
            </div>

            {!branding.hideAppBranding && (
                <div
                    style={{
                        marginTop: tokens.spacing[6],
                        marginBottom: tokens.spacing[6],
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                    }}
                >
                    Powered by <Logo size={16} />
                </div>
            )}
        </div>
    );
};

/** Build the value envelope the backend expects for this field's type. */
const toEnvelope = (field: PublicFormField, v: unknown): unknown => {
    if (field.fieldKind === "task_attr") return v; // raw string (name/description)
    switch (field.valueType) {
        case "date":
            return { date: v };
        case "dropdown":
            return { option_id: v };
        case "money":
            return {
                amount: Math.round(Number(v) * 100),
                currency: field.config?.currency ?? "BDT",
            };
        case "files":
            return undefined; // unsupported anonymously — skipped by caller
        case "text":
        case "phone":
        default:
            return { text: String(v) };
    }
};

const FormFieldInput = ({
    field,
    value,
    error,
    onChange,
}: {
    field: PublicFormField;
    value: unknown;
    error?: string;
    onChange: (v: unknown) => void;
}) => (
    <div data-field-key={field.fieldKey}>
        <label style={labelStyle}>
            {field.label}
            {field.isRequired && (
                <span style={{ color: tokens.colors.danger, marginLeft: 2 }}>
                    *
                </span>
            )}
        </label>
        {field.helpText && (
            <div
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    marginBottom: 4,
                }}
            >
                {field.helpText}
            </div>
        )}
        <FieldControl field={field} value={value} error={error} onChange={onChange} />
        {error && <ErrorText error={error} />}
    </div>
);

/** The actual input control, chosen by the field's value type. */
const FieldControl = ({
    field,
    value,
    error,
    onChange,
}: {
    field: PublicFormField;
    value: unknown;
    error?: string;
    onChange: (v: unknown) => void;
}) => {
    const status = error ? "error" : undefined;
    const placeholder = field.placeholder ?? undefined;

    // task_attr (name/description) and plain text/phone → text inputs.
    if (field.fieldKind === "task_attr") {
        if (field.fieldKey === "description") {
            return (
                <Input.TextArea
                    value={(value as string) ?? ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    status={status}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                />
            );
        }
        return (
            <Input
                value={(value as string) ?? ""}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                status={status}
            />
        );
    }

    switch (field.valueType) {
        case "date":
            return (
                <DatePicker
                    value={value ? dayjs(value as string) : undefined}
                    onChange={(d) => onChange(d ? d.toISOString() : undefined)}
                    status={status}
                    allowClear
                    style={{ width: "100%" }}
                    placeholder={placeholder ?? "Pick a date…"}
                />
            );
        case "dropdown":
            return (
                <Select
                    value={(value as string) || undefined}
                    onChange={(v) => onChange(v)}
                    options={(field.options ?? []).map((o) => ({
                        value: o.id,
                        label: o.label,
                    }))}
                    status={status}
                    allowClear
                    style={{ width: "100%" }}
                    placeholder={placeholder ?? "Select…"}
                />
            );
        case "money": {
            const currency = field.config?.currency ?? "BDT";
            const symbol = currency === "BDT" ? "৳" : currency;
            return (
                <InputNumber
                    value={value as number | null}
                    onChange={(v) => onChange(v ?? undefined)}
                    min={0}
                    precision={field.config?.precision ?? 2}
                    addonBefore={symbol}
                    placeholder={placeholder ?? "0.00"}
                    status={status}
                    style={{ width: "100%" }}
                />
            );
        }
        case "files":
            // P6 decision: anonymous upload is a backend feature (a public
            // presign endpoint, size caps, abuse protection), not something a
            // mobile phase can honestly ship. What it should NOT do meanwhile is
            // render a disabled text box — a customer reads that as a broken
            // field. Say the true thing in one line instead.
            return (
                <div
                    style={{
                        fontSize: 13,
                        color: tokens.colors.textMuted,
                        padding: "6px 0",
                    }}
                >
                    Photos can't be attached here yet — please describe it above and
                    we'll ask for pictures when we reply.
                </div>
            );
        case "phone":
            // A phone number typed on a QWERTY keyboard is a small daily tax on
            // every customer. `inputMode` raises the numeric pad; `type="tel"`
            // lets the browser offer a saved number.
            return (
                <Input
                    value={(value as string) ?? ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder ?? "01XXXXXXXXX"}
                    status={status}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                />
            );
        case "text":
        default:
            return (
                <Input
                    value={(value as string) ?? ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    status={status}
                />
            );
    }
};

const ErrorText = ({ error }: { error: string }) => (
    <div
        style={{
            fontSize: 11,
            color: tokens.colors.danger,
            marginTop: 4,
        }}
    >
        {error}
    </div>
);

const CenteredMessage = ({ children }: { children: React.ReactNode }) => (
    <div
        style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: tokens.spacing[6],
        }}
    >
        {children}
    </div>
);

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: 500,
    color: tokens.colors.textSecondary,
    marginBottom: 4,
};

export default PublicFormPage;
