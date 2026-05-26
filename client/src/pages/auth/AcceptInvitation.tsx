import { useState } from "react";
import { Alert, Button, Form, Input, Skeleton } from "antd";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, User as UserIcon, Mail } from "lucide-react";
import { FormCard } from "../../components/ui/FormCard";
import { PasswordStrengthMeter } from "../../components/ui/PasswordStrengthMeter";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

interface FormValues {
    firstName: string;
    lastName: string;
    password: string;
}

export const AcceptInvitationPage = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { setUser } = useAuthStore();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [password, setPassword] = useState("");

    const { data: invitation, isLoading } = useQuery({
        queryKey: ["invitation", token],
        queryFn: () => mockApi.auth.getInvitation(token ?? ""),
    });

    const { mutate, isPending } = useMutation({
        mutationFn: (values: FormValues) =>
            mockApi.auth.acceptInvitation(token ?? "", values),
        onSuccess: (user) => {
            setUser(user);
            navigate("/");
        },
        onError: (err: Error) => setErrorMessage(err.message),
    });

    if (isLoading) {
        return (
            <FormCard>
                <Skeleton active paragraph={{ rows: 4 }} />
            </FormCard>
        );
    }

    if (!invitation) {
        return (
            <FormCard
                title="Invitation invalid"
                description="This invitation link is invalid or has expired. Please ask your administrator to send a new one."
                footer={
                    <Link to="/login" style={{ color: tokens.colors.primary, fontWeight: 500 }}>
                        Back to login
                    </Link>
                }
            >
                <span />
            </FormCard>
        );
    }

    return (
        <FormCard
            title="Accept your invitation"
            description={
                <>
                    <strong style={{ color: tokens.colors.textPrimary }}>
                        {invitation.invitedByName}
                    </strong>{" "}
                    invited you to join{" "}
                    <strong style={{ color: tokens.colors.textPrimary }}>
                        {invitation.workspaceName}
                    </strong>{" "}
                    as a <em>{invitation.role}</em>.
                </>
            }
        >
            {errorMessage && (
                <Alert type="error" message={errorMessage} showIcon closable onClose={() => setErrorMessage(null)} />
            )}

            {/* Read-only email shown prominently */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[2],
                    padding: tokens.spacing[3],
                    background: tokens.colors.bgMuted,
                    borderRadius: tokens.radius.md,
                    fontSize: tokens.typography.fontSize.sm,
                }}
            >
                <Mail size={16} strokeWidth={1.75} color={tokens.colors.textMuted} />
                <span style={{ color: tokens.colors.textSecondary }}>
                    Joining as
                </span>
                <span
                    style={{
                        fontFamily: tokens.typography.fontFamilyMono,
                        color: tokens.colors.textPrimary,
                        fontWeight: 500,
                    }}
                >
                    {invitation.email}
                </span>
            </div>

            <Form<FormValues>
                layout="vertical"
                onFinish={(values) => {
                    setErrorMessage(null);
                    mutate(values);
                }}
                requiredMark={false}
            >
                <div style={{ display: "flex", gap: tokens.spacing[3] }}>
                    <Form.Item
                        name="firstName"
                        label="First name"
                        rules={[{ required: true, message: "Required" }]}
                        style={{ flex: 1 }}
                    >
                        <Input
                            prefix={<UserIcon size={16} strokeWidth={1.75} color={tokens.colors.textMuted} />}
                            placeholder="First"
                            size="large"
                            autoFocus
                        />
                    </Form.Item>
                    <Form.Item
                        name="lastName"
                        label="Last name"
                        rules={[{ required: true, message: "Required" }]}
                        style={{ flex: 1 }}
                    >
                        <Input placeholder="Last" size="large" />
                    </Form.Item>
                </div>

                <Form.Item
                    name="password"
                    label="Password"
                    rules={[
                        { required: true, message: "Password is required" },
                        { min: 8, message: "At least 8 characters" },
                    ]}
                >
                    <Input.Password
                        prefix={<Lock size={16} strokeWidth={1.75} color={tokens.colors.textMuted} />}
                        placeholder="Create a password"
                        size="large"
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </Form.Item>

                <div style={{ marginTop: -tokens.spacing[3], marginBottom: tokens.spacing[4] }}>
                    <PasswordStrengthMeter password={password} />
                </div>

                <Button type="primary" htmlType="submit" size="large" block loading={isPending}>
                    Accept invitation
                </Button>
            </Form>
        </FormCard>
    );
};

export default AcceptInvitationPage;
