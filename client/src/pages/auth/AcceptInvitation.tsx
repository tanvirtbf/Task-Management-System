import { useState } from "react";
import { Alert, App as AntApp, Button, Form, Input, Spin } from "antd";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, ArrowLeft } from "lucide-react";
import { FormCard } from "../../components/ui/FormCard";
import { PasswordRequirements } from "../../components/ui/PasswordRequirements";
import { passwordError } from "../../lib/passwordPolicy";
import { authApi } from "../../http/api";
import { getApiErrorMessage } from "../../http/client";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

interface FormValues {
    password: string;
    confirmPassword: string;
}

/**
 * Public invitation-accept landing (`/invitation/:token`). Fetches the
 * invitation summary to show who is being invited, takes a first password, then
 * accepts via the backend — which sets the password, activates the account, and
 * auto-logs-the-user-in (so we store the returned token + user and land in the
 * app, exactly like a fresh login).
 */
export const AcceptInvitationPage = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { message } = AntApp.useApp();
    const { setUser, setAccessToken } = useAuthStore();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [password, setPassword] = useState("");

    const {
        data: invitation,
        isLoading,
        error: loadError,
    } = useQuery({
        queryKey: ["invitation", token],
        queryFn: () => authApi.invitationDetails(token ?? ""),
        enabled: !!token,
        retry: false,
    });

    const { mutate, isPending } = useMutation({
        mutationFn: (values: FormValues) =>
            authApi.acceptInvitation(token ?? "", values.password),
        onSuccess: (result) => {
            setAccessToken(result.accessToken);
            setUser(result.user);
            message.success("Welcome aboard! Your account is ready.");
            navigate("/");
        },
        onError: (err: unknown) => setErrorMessage(getApiErrorMessage(err)),
    });

    // Invalid / expired / already-accepted invitation → explain and offer login.
    if (loadError) {
        return (
            <FormCard
                title="This invitation can't be used"
                description={getApiErrorMessage(loadError)}
                footer={
                    <Link
                        to="/login"
                        style={{ color: tokens.colors.primary, fontWeight: 500 }}
                    >
                        Go to login
                    </Link>
                }
            >
                <span />
            </FormCard>
        );
    }

    return (
        <FormCard
            title="Set up your account"
            description={
                invitation
                    ? `You've been invited to ${invitation.workspaceName} as ${invitation.email}. Choose a password to finish.`
                    : "Choose a password to finish setting up your account."
            }
            footer={
                <Link
                    to="/login"
                    style={{ color: tokens.colors.primary, fontWeight: 500 }}
                >
                    <ArrowLeft size={14} style={{ verticalAlign: "middle" }} /> Back
                    to login
                </Link>
            }
        >
            {isLoading ? (
                <div
                    style={{
                        textAlign: "center",
                        padding: tokens.spacing[5],
                    }}
                >
                    <Spin />
                </div>
            ) : (
                <>
                    {errorMessage && (
                        <Alert
                            type="error"
                            message={errorMessage}
                            showIcon
                            closable
                            onClose={() => setErrorMessage(null)}
                        />
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
                            label="Password"
                            rules={[
                                {
                                    required: true,
                                    message: "Password is required",
                                },
                                // The SAME four rules the API enforces, so the
                                // form can never accept what the server will
                                // refuse (or the reverse).
                                {
                                    validator: (_, value: string) => {
                                        const err = passwordError(value ?? "");
                                        return err
                                            ? Promise.reject(new Error(err))
                                            : Promise.resolve();
                                    },
                                },
                            ]}
                        >
                            <Input.Password
                                prefix={
                                    <Lock
                                        size={16}
                                        strokeWidth={1.75}
                                        color={tokens.colors.textMuted}
                                    />
                                }
                                placeholder="Create a password"
                                size="large"
                                autoFocus
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </Form.Item>

                        <div
                            style={{
                                marginTop: -tokens.spacing[3],
                                marginBottom: tokens.spacing[4],
                            }}
                        >
                            <PasswordRequirements password={password} />
                        </div>

                        <Form.Item
                            name="confirmPassword"
                            label="Confirm password"
                            dependencies={["password"]}
                            rules={[
                                { required: true, message: "Please confirm" },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        if (
                                            !value ||
                                            getFieldValue("password") === value
                                        ) {
                                            return Promise.resolve();
                                        }
                                        return Promise.reject(
                                            new Error("Passwords don't match"),
                                        );
                                    },
                                }),
                            ]}
                        >
                            <Input.Password
                                prefix={
                                    <Lock
                                        size={16}
                                        strokeWidth={1.75}
                                        color={tokens.colors.textMuted}
                                    />
                                }
                                placeholder="Re-type your password"
                                size="large"
                            />
                        </Form.Item>

                        <Button
                            type="primary"
                            htmlType="submit"
                            size="large"
                            block
                            loading={isPending}
                        >
                            Create account & sign in
                        </Button>
                    </Form>
                </>
            )}
        </FormCard>
    );
};

export default AcceptInvitationPage;
