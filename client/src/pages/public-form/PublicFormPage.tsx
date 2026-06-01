import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Alert, Button, DatePicker, Input, InputNumber, Select } from "antd";
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
            }
        }
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
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
                padding: tokens.spacing[6],
            }}
        >
            <div
                style={{
                    maxWidth: 560,
                    width: "100%",
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.xl,
                    padding: tokens.spacing[8],
                    boxShadow: tokens.shadows.md,
                    marginTop: tokens.spacing[6],
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
    <div>
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
            return (
                <Input
                    disabled
                    placeholder="File uploads aren't available on public forms"
                />
            );
        case "text":
        case "phone":
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
