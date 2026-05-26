import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { FormCard } from "../../components/ui/FormCard";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

const CODE_LENGTH = 6;

export const TwoFactorChallengePage = () => {
    const navigate = useNavigate();
    const { pendingTwoFactor, setUser, setPendingTwoFactor } = useAuthStore();
    const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(""));
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Guard: if no pending 2FA, redirect to login
    useEffect(() => {
        if (!pendingTwoFactor) {
            navigate("/login", { replace: true });
        } else {
            inputRefs.current[0]?.focus();
        }
    }, [pendingTwoFactor, navigate]);

    const { mutate, isPending } = useMutation({
        mutationFn: (fullCode: string) =>
            mockApi.auth.verify2fa(pendingTwoFactor!.mfaToken, fullCode),
        onSuccess: (user) => {
            setUser(user);
            setPendingTwoFactor(null);
            navigate("/");
        },
        onError: (err: Error) => {
            setErrorMessage(err.message);
            setCode(Array(CODE_LENGTH).fill(""));
            inputRefs.current[0]?.focus();
        },
    });

    const handleChange = (idx: number, value: string) => {
        const sanitized = value.replace(/\D/g, "").slice(0, 1);
        const next = [...code];
        next[idx] = sanitized;
        setCode(next);
        setErrorMessage(null);

        if (sanitized && idx < CODE_LENGTH - 1) {
            inputRefs.current[idx + 1]?.focus();
        }

        // Auto-submit on full code
        if (next.every((c) => c) && next.join("").length === CODE_LENGTH) {
            mutate(next.join(""));
        }
    };

    const handleKeyDown = (
        idx: number,
        e: React.KeyboardEvent<HTMLInputElement>,
    ) => {
        if (e.key === "Backspace" && !code[idx] && idx > 0) {
            inputRefs.current[idx - 1]?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const text = e.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, CODE_LENGTH);
        if (text.length === CODE_LENGTH) {
            setCode(text.split(""));
            mutate(text);
        }
    };

    if (!pendingTwoFactor) return null;

    return (
        <FormCard
            title="Two-step verification"
            description={
                <>
                    Enter the 6-digit code from your authenticator app for{" "}
                    <strong style={{ color: tokens.colors.textPrimary }}>
                        {pendingTwoFactor.email}
                    </strong>
                </>
            }
            footer={
                <Link
                    to="/login"
                    onClick={() => setPendingTwoFactor(null)}
                    style={{
                        color: tokens.colors.primary,
                        fontWeight: 500,
                    }}
                >
                    ← Back to login
                </Link>
            }
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    width: 48,
                    height: 48,
                    borderRadius: tokens.radius.lg,
                    background: tokens.colors.primarySubtle,
                    color: tokens.colors.primary,
                    alignItems: "center",
                    alignSelf: "center",
                }}
            >
                <ShieldCheck size={24} strokeWidth={1.75} />
            </div>

            {errorMessage && (
                <Alert
                    type="error"
                    message={errorMessage}
                    showIcon
                    closable
                    onClose={() => setErrorMessage(null)}
                />
            )}

            <div
                style={{
                    display: "flex",
                    gap: tokens.spacing[2],
                    justifyContent: "center",
                }}
            >
                {code.map((digit, idx) => (
                    <input
                        key={idx}
                        ref={(el) => {
                            inputRefs.current[idx] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(idx, e)}
                        onPaste={handlePaste}
                        disabled={isPending}
                        style={{
                            width: 44,
                            height: 52,
                            textAlign: "center",
                            fontSize: 22,
                            fontWeight: 600,
                            fontFamily: tokens.typography.fontFamilyMono,
                            borderRadius: tokens.radius.md,
                            border: `1.5px solid ${
                                digit ? tokens.colors.primary : tokens.colors.border
                            }`,
                            background: tokens.colors.bgSurface,
                            color: tokens.colors.textPrimary,
                            outline: "none",
                            transition: "all var(--transition-base)",
                        }}
                        autoComplete={idx === 0 ? "one-time-code" : "off"}
                    />
                ))}
            </div>

            <Button
                type="primary"
                size="large"
                block
                loading={isPending}
                onClick={() => mutate(code.join(""))}
                disabled={code.some((c) => !c)}
            >
                Verify
            </Button>

            <div
                style={{
                    fontSize: tokens.typography.fontSize.xs,
                    color: tokens.colors.textMuted,
                    textAlign: "center",
                }}
            >
                Demo: enter any 6 digits (e.g.{" "}
                <code style={{ fontFamily: tokens.typography.fontFamilyMono }}>
                    123456
                </code>
                )
            </div>
        </FormCard>
    );
};

export default TwoFactorChallengePage;
