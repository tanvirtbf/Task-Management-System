import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, Card, Space, Typography } from "antd";
import { BellRing } from "lucide-react";
import { useAuthStore } from "../../stores/auth";
import {
    ensurePushSubscription,
    isPushSupported,
    requestPushPermission,
} from "../../lib/push";
import { tokens } from "../../theme";

/**
 * First-sign-in notification opt-in (§29c, 2026-08-08).
 *
 * Browsers only honour `Notification.requestPermission()` from a user gesture,
 * and spending the ONE native prompt an origin gets on an unexplained
 * page-load ask is exactly how a site ends up permanently blocked. So a small
 * in-app card explains WHY first, and the native dialog appears only after the
 * person clicks Enable.
 *
 * Permission is per DEVICE, not per account, so the state machine is:
 *   granted  → no UI; silently (re)register, which also re-binds a shared
 *              computer to whoever just signed in.
 *   default  → show the card once per device (a dismissal is remembered).
 *   denied   → stay silent. Only the browser's own site settings can undo it;
 *              a web page nagging about it achieves nothing.
 *
 * `Settings → Profile → Notifications` is the deliberate second door, so
 * "Not now" is never a one-way trip.
 */

const PUSH_DISMISS_KEY = "bb-push-prompt-dismissed";

export const PushPrompt = () => {
    const user = useAuthStore((s) => s.user);
    const { message } = AntApp.useApp();
    // Computed once at mount from device state (permission is a browser fact,
    // not React state), so the effect below never has to call setState.
    const [visible, setVisible] = useState(
        () =>
            isPushSupported() &&
            Notification.permission === "default" &&
            !localStorage.getItem(PUSH_DISMISS_KEY),
    );
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        // Already-trusted device: no UI, just (re)bind it to THIS account —
        // which is what moves a shared computer to whoever just signed in.
        if (!user || !isPushSupported()) return;
        if (Notification.permission === "granted") {
            void ensurePushSubscription();
        }
    }, [user]);

    const dismiss = useCallback(() => {
        localStorage.setItem(PUSH_DISMISS_KEY, "1");
        setVisible(false);
    }, []);

    const enable = useCallback(async () => {
        setBusy(true);
        try {
            const result = await requestPushPermission();
            if (result === "granted") {
                message.success(
                    "Notifications চালু হয়েছে — কেউ টাস্ক দিলে সাথে সাথে জানবেন।",
                );
            } else if (result === "denied") {
                message.info(
                    "Notification block করা হয়েছে। চালু করতে ব্রাউজারের site settings থেকে Allow করুন।",
                );
            } else if (result === "failed") {
                message.warning(
                    "Permission পাওয়া গেছে, কিন্তু ডিভাইস রেজিস্টার হয়নি — পরে আবার চেষ্টা হবে।",
                );
            }
        } finally {
            setBusy(false);
            dismiss(); // ask once per device, whatever the answer was
        }
    }, [dismiss, message]);

    if (!visible) return null;

    return (
        <Card
            size="small"
            role="region"
            aria-label="Enable notifications"
            style={{
                position: "fixed",
                left: 16,
                bottom: 16,
                zIndex: 1000,
                width: 340,
                maxWidth: "calc(100vw - 32px)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
                borderRadius: 12,
            }}
            styles={{ body: { padding: 16 } }}
        >
            <Space align="start" size={12}>
                <BellRing
                    size={22}
                    aria-hidden
                    style={{ color: tokens.colors.primary, marginTop: 2 }}
                />
                <div>
                    <Typography.Text strong>
                        Turn on notifications?
                    </Typography.Text>
                    <Typography.Paragraph
                        type="secondary"
                        style={{ margin: "4px 0 12px", fontSize: 13 }}
                    >
                        কেউ আপনাকে টাস্ক দিলে বা কাজের সময় পার হয়ে গেলে সাথে
                        সাথে জানতে পারবেন — অ্যাপ বন্ধ থাকলেও।
                    </Typography.Paragraph>
                    <Space>
                        <Button
                            type="primary"
                            size="small"
                            loading={busy}
                            onClick={() => void enable()}
                        >
                            Enable
                        </Button>
                        <Button size="small" onClick={dismiss}>
                            Not now
                        </Button>
                    </Space>
                </div>
            </Space>
        </Card>
    );
};
