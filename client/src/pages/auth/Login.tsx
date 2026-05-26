import { useState } from "react";
import { Alert, Button, Checkbox, Form, Input } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Mail, Lock } from "lucide-react";
import { FormCard } from "../../components/ui/FormCard";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

interface LoginFormValues {
    email: string;
    password: string;
    remember: boolean;
}

export const LoginPage = () => {
    const navigate = useNavigate();
    const { setUser, setPendingTwoFactor } = useAuthStore();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const { mutate, isPending } = useMutation({
        mutationFn: (values: LoginFormValues) =>
            mockApi.auth.login(values.email, values.password),
        onSuccess: (result, variables) => {
            if (result.requires2fa) {
                setPendingTwoFactor({
                    email: variables.email,
                    mfaToken: result.mfaToken,
                });
                navigate("/login/2fa");
            } else {
                setUser(result.user);
                navigate("/");
            }
        },
        onError: (err: Error) => {
            setErrorMessage(err.message || "Something went wrong. Try again.");
        },
    });

    return (
        <FormCard
            title="Welcome back"
            description="Sign in to your workspace to continue."
            footer={
                <span>
                    Don't have an account?{" "}
                    <strong style={{ color: tokens.colors.textPrimary }}>
                        Contact your administrator.
                    </strong>
                </span>
            }
        >
            {errorMessage && (
                <Alert
                    type="error"
                    message={errorMessage}
                    showIcon
                    closable
                    onClose={() => setErrorMessage(null)}
                />
            )}

            <Form<LoginFormValues>
                layout="vertical"
                onFinish={(values) => {
                    setErrorMessage(null);
                    mutate(values);
                }}
                initialValues={{ remember: true }}
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
                        autoComplete="email"
                        autoFocus
                    />
                </Form.Item>

                <Form.Item
                    name="password"
                    label={
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                width: "100%",
                            }}
                        >
                            <span>Password</span>
                            <Link
                                to="/forgot-password"
                                style={{
                                    fontSize: tokens.typography.fontSize.sm,
                                    color: tokens.colors.primary,
                                    fontWeight: 500,
                                }}
                            >
                                Forgot password?
                            </Link>
                        </div>
                    }
                    rules={[
                        { required: true, message: "Password is required" },
                        { min: 8, message: "At least 8 characters" },
                    ]}
                >
                    <Input.Password
                        prefix={<Lock size={16} strokeWidth={1.75} color={tokens.colors.textMuted} />}
                        placeholder="Enter your password"
                        size="large"
                        autoComplete="current-password"
                    />
                </Form.Item>

                <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: tokens.spacing[5] }}>
                    <Checkbox>Keep me signed in</Checkbox>
                </Form.Item>

                <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={isPending}
                >
                    Sign in
                </Button>
            </Form>

            <div
                style={{
                    fontSize: tokens.typography.fontSize.xs,
                    color: tokens.colors.textMuted,
                    textAlign: "center",
                    lineHeight: 1.5,
                    paddingTop: tokens.spacing[2],
                    borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                }}
            >
                <div style={{ marginBottom: 6, fontWeight: 500, color: tokens.colors.textSecondary }}>
                    Demo accounts (any password ≥ 8 chars):
                </div>
                <code style={{ fontFamily: tokens.typography.fontFamilyMono }}>
                    owner@company.local
                </code>{" "}
                ·{" "}
                <code style={{ fontFamily: tokens.typography.fontFamilyMono }}>
                    admin@company.local
                </code>{" "}
                ·{" "}
                <code style={{ fontFamily: tokens.typography.fontFamilyMono }}>
                    member@company.local
                </code>
            </div>
        </FormCard>
    );
};

export default LoginPage;
