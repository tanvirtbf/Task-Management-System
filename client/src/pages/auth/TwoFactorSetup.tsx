import { useState } from "react";
import { Alert, Button } from "antd";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { Copy, ShieldCheck } from "lucide-react";
import { FormCard } from "../../components/ui/FormCard";
import { mockApi } from "../../lib/mock-api";
import { tokens } from "../../theme";

export const TwoFactorSetupPage = () => {
    const navigate = useNavigate();
    const { message } = AntApp.useApp();
    const [code, setCode] = useState("");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

    const { data: setupData, isLoading } = useQuery({
        queryKey: ["2fa-setup"],
        queryFn: () => mockApi.auth.setup2fa(),
    });

    const { mutate, isPending } = useMutation({
        mutationFn: (verifyCode: string) => mockApi.auth.enable2fa(verifyCode),
        onSuccess: ({ backupCodes: codes }) => {
            setBackupCodes(codes);
        },
        onError: (err: Error) => setErrorMessage(err.message),
    });

    if (isLoading || !setupData) {
        return <FormCard>Loading…</FormCard>;
    }

    if (backupCodes) {
        return (
            <FormCard
                title="Save your backup codes"
                description="Keep these somewhere safe. Each can be used once if you lose access to your authenticator app."
            >
                <div
                    style={{
                        background: tokens.colors.bgMuted,
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.md,
                        padding: tokens.spacing[4],
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: tokens.spacing[2],
                        fontFamily: tokens.typography.fontFamilyMono,
                        fontSize: tokens.typography.fontSize.base,
                        letterSpacing: "0.05em",
                    }}
                >
                    {backupCodes.map((c) => (
                        <div key={c}>{c}</div>
                    ))}
                </div>

                <Button
                    icon={<Copy size={14} />}
                    block
                    onClick={() => {
                        navigator.clipboard.writeText(backupCodes.join("\n"));
                        message.success("Backup codes copied to clipboard");
                    }}
                >
                    Copy codes
                </Button>

                <Button
                    type="primary"
                    size="large"
                    block
                    onClick={() => navigate("/settings/2fa")}
                >
                    I've saved them — done
                </Button>
            </FormCard>
        );
    }

    return (
        <FormCard
            title="Set up two-step verification"
            description="Scan the QR code with Google Authenticator, Authy, or 1Password, then enter the 6-digit code to confirm."
        >
            {errorMessage && (
                <Alert type="error" message={errorMessage} showIcon closable onClose={() => setErrorMessage(null)} />
            )}

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                    padding: tokens.spacing[4],
                    background: tokens.colors.bgMuted,
                    borderRadius: tokens.radius.md,
                }}
            >
                {/* Placeholder QR — in real app, render real QR via library */}
                <div
                    style={{
                        width: 160,
                        height: 160,
                        background: "#FFFFFF",
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.md,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: tokens.colors.textMuted,
                        fontSize: tokens.typography.fontSize.sm,
                        textAlign: "center",
                        padding: tokens.spacing[3],
                    }}
                >
                    <ShieldCheck size={48} strokeWidth={1} color={tokens.colors.primary} />
                </div>

                <div
                    style={{
                        fontSize: tokens.typography.fontSize.xs,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    Or enter manually:
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: tokens.spacing[2],
                    }}
                >
                    <code
                        style={{
                            fontFamily: tokens.typography.fontFamilyMono,
                            fontSize: tokens.typography.fontSize.base,
                            letterSpacing: "0.1em",
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        {setupData.secret}
                    </code>
                    <Button
                        size="small"
                        type="text"
                        icon={<Copy size={14} />}
                        onClick={() => {
                            navigator.clipboard.writeText(setupData.secret);
                            message.success("Secret copied");
                        }}
                    />
                </div>
            </div>

            <div>
                <label
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 500,
                        display: "block",
                        marginBottom: tokens.spacing[2],
                    }}
                >
                    Verification code
                </label>
                <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                        setErrorMessage(null);
                    }}
                    placeholder="123456"
                    style={{
                        width: "100%",
                        height: 48,
                        padding: "0 14px",
                        fontSize: 20,
                        fontWeight: 600,
                        fontFamily: tokens.typography.fontFamilyMono,
                        letterSpacing: "0.5em",
                        textAlign: "center",
                        border: `1.5px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.md,
                        background: tokens.colors.bgSurface,
                        color: tokens.colors.textPrimary,
                        outline: "none",
                    }}
                />
            </div>

            <Button
                type="primary"
                size="large"
                block
                loading={isPending}
                disabled={code.length !== 6}
                onClick={() => mutate(code)}
            >
                Enable two-step verification
            </Button>
        </FormCard>
    );
};

export default TwoFactorSetupPage;
