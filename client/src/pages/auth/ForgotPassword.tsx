import { useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Mail, CheckCircle2 } from "lucide-react";
import { FormCard } from "../../components/ui/FormCard";
import { mockApi } from "../../lib/mock-api";
import { tokens } from "../../theme";

export const ForgotPasswordPage = () => {
    const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const { mutate, isPending } = useMutation({
        mutationFn: (email: string) => mockApi.auth.forgotPassword(email),
        onSuccess: (_data, email) => setSubmittedEmail(email),
        onError: (err: Error) => setErrorMessage(err.message),
    });

    if (submittedEmail) {
        return (
            <FormCard
                footer={
                    <Link to="/login" style={{ color: tokens.colors.primary, fontWeight: 500 }}>
                        <ArrowLeft size={14} style={{ verticalAlign: "middle" }} />{" "}
                        Back to login
                    </Link>
                }
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                        gap: tokens.spacing[4],
                    }}
                >
                    <div
                        style={{
                            width: 56,
                            height: 56,
                            borderRadius: tokens.radius.full,
                            background: tokens.colors.successSubtle,
                            color: tokens.colors.success,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <CheckCircle2 size={28} strokeWidth={1.75} />
                    </div>

                    <div>
                        <h1
                            style={{
                                fontSize: tokens.typography.fontSize["2xl"],
                                fontWeight: 600,
                                color: tokens.colors.textPrimary,
                                margin: 0,
                                marginBottom: tokens.spacing[2],
                                letterSpacing: "-0.02em",
                            }}
                        >
                            Check your inbox
                        </h1>
                        <p
                            style={{
                                fontSize: tokens.typography.fontSize.base,
                                color: tokens.colors.textSecondary,
                                margin: 0,
                                lineHeight: 1.6,
                            }}
                        >
                            If an account exists for{" "}
                            <strong style={{ color: tokens.colors.textPrimary }}>
                                {submittedEmail}
                            </strong>
                            , we've sent reset instructions to that address.
                        </p>
                    </div>

                    <Button
                        type="default"
                        size="large"
                        block
                        onClick={() => setSubmittedEmail(null)}
                    >
                        Try a different email
                    </Button>
                </div>
            </FormCard>
        );
    }

    return (
        <FormCard
            title="Reset your password"
            description="Enter your account email and we'll send you a link to set a new password."
            footer={
                <Link to="/login" style={{ color: tokens.colors.primary, fontWeight: 500 }}>
                    <ArrowLeft size={14} style={{ verticalAlign: "middle" }} /> Back to login
                </Link>
            }
        >
            {errorMessage && (
                <Alert type="error" message={errorMessage} showIcon closable onClose={() => setErrorMessage(null)} />
            )}

            <Form
                layout="vertical"
                onFinish={({ email }) => {
                    setErrorMessage(null);
                    mutate(email);
                }}
                requiredMark={false}
            >
                <Form.Item
                    name="email"
                    label="Email"
                    rules={[
                        { required: true, message: "Email is required" },
                        { type: "email", message: "Enter a valid email" },
                    ]}
                >
                    <Input
                        prefix={<Mail size={16} strokeWidth={1.75} color={tokens.colors.textMuted} />}
                        placeholder="you@company.local"
                        size="large"
                        autoFocus
                    />
                </Form.Item>

                <Button type="primary" htmlType="submit" size="large" block loading={isPending}>
                    Send reset link
                </Button>
            </Form>
        </FormCard>
    );
};

export default ForgotPasswordPage;
