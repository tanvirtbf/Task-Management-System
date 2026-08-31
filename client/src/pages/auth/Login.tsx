import { useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Mail, Lock } from "lucide-react";
import { FormCard } from "../../components/ui/FormCard";
import { authApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

interface LoginFormValues {
    email: string;
    password: string;
}

export const LoginPage = () => {
    const navigate = useNavigate();
    const { setUser, setAccessToken } = useAuthStore();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const { mutate, isPending } = useMutation({
        mutationFn: (values: LoginFormValues) =>
            authApi.login({ email: values.email, password: values.password }),
        onSuccess: (result) => {
            setAccessToken(result.accessToken);
            setUser(result.user);
            navigate("/");
        },
        onError: (err: unknown) => {
            setErrorMessage(getApiErrorMessage(err));
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
                    // Lets the label below span the field so "Forgot password?"
                    // can sit opposite the caption — see `.form-label-row` in
                    // index.css for why antd needs telling.
                    className="form-label-row"
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
                    /*
                     * `required` only — deliberately NOT the 8-character
                     * minimum from the password policy.
                     *
                     * That policy governs passwords being SET. Applying it to
                     * sign-in makes this form stricter than the API it talks to
                     * (`loginValidator` accepts 1–200 characters), and a client
                     * that is stricter than its server on a login screen can
                     * only ever do one thing: lock somebody out. Any account
                     * whose password predates the policy — or one seeded with
                     * an operator-chosen `SEED_OWNER_PASSWORD`, which nothing
                     * length-checks — could not sign in here at all, and would
                     * be told "At least 8 characters", which reads as "your
                     * password is wrong" rather than "this form is refusing to
                     * send it".
                     */
                    rules={[
                        { required: true, message: "Password is required" },
                    ]}
                >
                    <Input.Password
                        prefix={<Lock size={16} strokeWidth={1.75} color={tokens.colors.textMuted} />}
                        placeholder="Enter your password"
                        size="large"
                        autoComplete="current-password"
                    />
                </Form.Item>

                {/*
                 * There is deliberately no "Keep me signed in" checkbox.
                 *
                 * One used to sit here, checked by default — and its value was
                 * never sent anywhere. `authApi.login` posts email and password
                 * only, and the server has no notion of a short session: every
                 * sign-in issues the same ~30-day refresh cookie. So the control
                 * did nothing, and it did nothing in the dangerous direction —
                 * on the shared machines this workspace runs on, a person who
                 * UNCHECKED it had every reason to expect the session to end
                 * with the browser, and instead got the full thirty days.
                 *
                 * Removed rather than implemented: varying the session lifetime
                 * is a feature (validator, token TTL, cookie maxAge, and a
                 * decision about how short "short" is), and it is on the gate
                 * ledger. Please do not re-add the checkbox before the server
                 * can honour it.
                 */}

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
        </FormCard>
    );
};

export default LoginPage;
