import { useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { Lock, ArrowLeft } from "lucide-react";
import { FormCard } from "../../components/ui/FormCard";
import { PasswordStrengthMeter } from "../../components/ui/PasswordStrengthMeter";
import { mockApi } from "../../lib/mock-api";
import { tokens } from "../../theme";

interface FormValues {
    password: string;
    confirmPassword: string;
}

export const ResetPasswordPage = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { message } = AntApp.useApp();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [password, setPassword] = useState("");

    const { mutate, isPending } = useMutation({
        mutationFn: (values: FormValues) =>
            mockApi.auth.resetPassword(token ?? "", values.password),
        onSuccess: () => {
            message.success("Password updated. Please sign in.");
            navigate("/login");
        },
        onError: (err: Error) => setErrorMessage(err.message),
    });

    return (
        <FormCard
            title="Set a new password"
            description="Choose a strong password you haven't used elsewhere."
            footer={
                <Link to="/login" style={{ color: tokens.colors.primary, fontWeight: 500 }}>
                    <ArrowLeft size={14} style={{ verticalAlign: "middle" }} /> Back to login
                </Link>
            }
        >
            {errorMessage && (
                <Alert type="error" message={errorMessage} showIcon closable onClose={() => setErrorMessage(null)} />
            )}

            <Form<FormValues>
                layout="vertical"
                onFinish={(values) => {
                    setErrorMessage(null);
                    mutate(values);
                }}
                requiredMark={false}
            >
                <Form.Item
                    name="password"
                    label="New password"
                    rules={[
                        { required: true, message: "Password is required" },
                        { min: 8, message: "Must be at least 8 characters" },
                    ]}
                >
                    <Input.Password
                        prefix={<Lock size={16} strokeWidth={1.75} color={tokens.colors.textMuted} />}
                        placeholder="Enter new password"
                        size="large"
                        autoFocus
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </Form.Item>

                <div style={{ marginTop: -tokens.spacing[3], marginBottom: tokens.spacing[4] }}>
                    <PasswordStrengthMeter password={password} />
                </div>

                <Form.Item
                    name="confirmPassword"
                    label="Confirm new password"
                    dependencies={["password"]}
                    rules={[
                        { required: true, message: "Please confirm" },
                        ({ getFieldValue }) => ({
                            validator(_, value) {
                                if (!value || getFieldValue("password") === value) {
                                    return Promise.resolve();
                                }
                                return Promise.reject(new Error("Passwords don't match"));
                            },
                        }),
                    ]}
                >
                    <Input.Password
                        prefix={<Lock size={16} strokeWidth={1.75} color={tokens.colors.textMuted} />}
                        placeholder="Re-type new password"
                        size="large"
                    />
                </Form.Item>

                <Button type="primary" htmlType="submit" size="large" block loading={isPending}>
                    Update password
                </Button>
            </Form>
        </FormCard>
    );
};

export default ResetPasswordPage;
