import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Alert, Button, Input } from "antd";
import { CheckCircle2, AlertCircle, ShieldCheck } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { customFieldsById } from "../../mocks/custom-fields";
import { CustomFieldRenderer } from "../../components/custom-field/CustomFieldRenderer";
import { Logo } from "../../components/ui/Logo";
import type { ConditionalLogic, FormFieldDef } from "../../types/custom-fields";
import { tokens } from "../../theme";

const PublicFormPage = () => {
    const { slug } = useParams();
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);

    const { data: form, isLoading } = useQuery({
        queryKey: ["public-form", slug],
        queryFn: () =>
            slug ? mockApi.forms.getBySlug(slug) : Promise.resolve(null),
        enabled: !!slug,
    });

    const submit = useMutation({
        mutationFn: () => mockApi.forms.submit(slug!, values),
        onSuccess: () => {
            setSubmitted(true);
            if (form?.settings.redirectUrl) {
                setTimeout(() => {
                    if (form.settings.redirectUrl)
                        window.location.href = form.settings.redirectUrl;
                }, 1500);
            }
        },
    });

    // Build visible fields based on conditional logic
    const visibleFields = useMemo(() => {
        if (!form) return [];
        return form.fields.filter((f) => {
            if (f.isHidden) return false;
            if (!f.conditionalLogic) return true;
            return evalConditional(f.conditionalLogic, values, form.fields);
        });
    }, [form, values]);

    if (isLoading) {
        return <CenteredMessage>Loading form...</CenteredMessage>;
    }
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

    if (!form.settings.submissionOpen) {
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
                    <div>This form is currently not accepting submissions.</div>
                </div>
            </CenteredMessage>
        );
    }

    const handleSubmit = () => {
        const newErrors: Record<string, string> = {};
        for (const field of visibleFields) {
            if (field.isRequired) {
                const val = values[field.fieldKey];
                if (
                    val === undefined ||
                    val === null ||
                    val === "" ||
                    (Array.isArray(val) && val.length === 0)
                ) {
                    newErrors[field.fieldKey] = "This field is required";
                }
            }
        }
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }
        setErrors({});
        submit.mutate();
    };

    const primaryColor = form.branding.primaryColor;
    const isTwoCol = form.branding.layout === "two_column";

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
                        {form.settings.successMessage ??
                            "Thanks for your submission. We'll be in touch."}
                    </p>
                    {form.settings.redirectUrl && (
                        <div
                            style={{
                                marginTop: tokens.spacing[4],
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Redirecting...
                        </div>
                    )}
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
                    maxWidth: isTwoCol ? 760 : 560,
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
                        borderRadius: 999,
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
                        message="Submission failed. Please try again."
                        showIcon
                        style={{ marginBottom: tokens.spacing[3] }}
                    />
                )}

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: isTwoCol ? "1fr 1fr" : "1fr",
                        gap: tokens.spacing[4],
                    }}
                >
                    {visibleFields.map((field) => (
                        <FormFieldInput
                            key={field.id}
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

                {form.settings.enableRecaptcha && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: tokens.spacing[3],
                            background: tokens.colors.bgMuted,
                            border: `1px solid ${tokens.colors.borderSubtle}`,
                            borderRadius: tokens.radius.sm,
                            marginTop: tokens.spacing[4],
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                        }}
                    >
                        <ShieldCheck
                            size={14}
                            strokeWidth={1.75}
                            color={tokens.colors.success}
                        />
                        Protected by reCAPTCHA (demo — auto-passes)
                    </div>
                )}

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

            {!form.branding.hideAppBranding && (
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

const FormFieldInput = ({
    field,
    value,
    error,
    onChange,
}: {
    field: FormFieldDef;
    value: unknown;
    error?: string;
    onChange: (v: unknown) => void;
}) => {
    if (field.fieldKind === "task_attr") {
        // Special handling for task attrs (name, description)
        return (
            <div>
                <label style={labelStyle}>
                    {field.label}
                    {field.isRequired && (
                        <span
                            style={{
                                color: tokens.colors.danger,
                                marginLeft: 2,
                            }}
                        >
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
                <Input
                    value={String(value ?? "")}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={field.placeholder}
                    status={error ? "error" : undefined}
                />
                {error && <ErrorText error={error} />}
            </div>
        );
    }

    const customField = customFieldsById.get(field.fieldKey);
    if (!customField) {
        return (
            <div
                style={{
                    fontSize: 12,
                    color: tokens.colors.textMuted,
                }}
            >
                Unknown field: {field.fieldKey}
            </div>
        );
    }

    return (
        <div>
            <label style={labelStyle}>
                {field.label}
                {field.isRequired && (
                    <span
                        style={{
                            color: tokens.colors.danger,
                            marginLeft: 2,
                        }}
                    >
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
            <CustomFieldRenderer
                field={customField}
                value={value}
                onChange={onChange}
            />
            {error && <ErrorText error={error} />}
        </div>
    );
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

// ─── Conditional logic evaluator ────────────────────────
function evalConditional(
    logic: ConditionalLogic,
    values: Record<string, unknown>,
    fields: FormFieldDef[],
): boolean {
    if (!logic.rules || logic.rules.length === 0) return logic.action === "show";

    const results = logic.rules.map((rule) => {
        const triggerField = fields.find((f) => f.id === rule.triggerFieldId);
        if (!triggerField) return false;
        const value = values[triggerField.fieldKey];
        return evalOperator(rule.operator, value, rule.value);
    });

    const passed =
        logic.logic === "AND"
            ? results.every(Boolean)
            : results.some(Boolean);

    return logic.action === "show" ? passed : !passed;
}

function evalOperator(
    operator: string,
    value: unknown,
    target: unknown,
): boolean {
    // Unwrap value envelope
    const v =
        value && typeof value === "object" && value !== null
            ? "option_id" in value
                ? (value as { option_id?: unknown }).option_id
                : "text" in value
                  ? (value as { text?: unknown }).text
                  : value
            : value;

    switch (operator) {
        case "eq":
            return v === target;
        case "neq":
            return v !== target;
        case "is_empty":
            return v === undefined || v === null || v === "";
        case "is_not_empty":
            return v !== undefined && v !== null && v !== "";
        case "contains":
            return typeof v === "string" && v.includes(String(target));
        case "not_contains":
            return typeof v === "string" && !v.includes(String(target));
        default:
            return false;
    }
}

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: 500,
    color: tokens.colors.textSecondary,
    marginBottom: 4,
};

export default PublicFormPage;
