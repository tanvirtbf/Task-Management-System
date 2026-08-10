import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select, Modal, Space, App as AntApp } from "antd";
import { Save, KeyRound, BellRing } from "lucide-react";
import { authApi, usersApi } from "../../http/api";
import { useAuthStore } from "../../stores/auth";
import { isPushSupported, requestPushPermission } from "../../lib/push";
import {
    SettingsHeader,
    SettingsSection,
    SettingsFieldRow,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";

const TIMEZONES = [
    "Asia/Dhaka",
    "Asia/Kolkata",
    "Asia/Karachi",
    "Asia/Singapore",
    "UTC",
    "Europe/London",
    "America/New_York",
    "America/Los_Angeles",
];

const ProfileSettings = () => {
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);
    const { message } = AntApp.useApp();
    const qc = useQueryClient();

    const [firstName, setFirstName] = useState(user?.firstName ?? "");
    const [lastName, setLastName] = useState(user?.lastName ?? "");
    const [email, setEmail] = useState(user?.email ?? "");
    const [timezone, setTimezone] = useState(user?.timezone ?? "Asia/Dhaka");

    useEffect(() => {
        if (user) {
            setFirstName(user.firstName);
            setLastName(user.lastName);
            setEmail(user.email);
            setTimezone(user.timezone);
        }
    }, [user]);

    const saveProfile = useMutation({
        mutationFn: () =>
            user
                ? usersApi.updateProfile(user.id, {
                      firstName,
                      lastName,
                      email,
                      timezone,
                  })
                : Promise.reject(new Error("Not signed in")),
        onSuccess: (updated) => {
            setUser(updated);
            qc.invalidateQueries({ queryKey: ["users"] });
            message.success("Profile saved");
        },
        onError: (err) => {
            message.error(
                err instanceof Error ? err.message : "Failed to save profile",
            );
        },
    });

    const [pwOpen, setPwOpen] = useState(false);
    const [currentPw, setCurrentPw] = useState("");
    const [newPw, setNewPw] = useState("");
    const [confirmPw, setConfirmPw] = useState("");

    const changePw = useMutation({
        mutationFn: () => authApi.changePassword(currentPw, newPw),
        onSuccess: () => {
            message.success("Password changed");
            setPwOpen(false);
            setCurrentPw("");
            setNewPw("");
            setConfirmPw("");
        },
        onError: (err) =>
            message.error(
                err instanceof Error
                    ? err.message
                    : "Failed to change password",
            ),
    });

    const pwValid =
        currentPw.length > 0 && newPw.length >= 8 && newPw === confirmPw;

    // §29c — the deliberate second door for Web Push: the sign-in prompt asks
    // once per device, so without this a stray "Not now" would be permanent.
    // Permission is device state, not account state, so it is read from the
    // browser rather than the server.
    const [pushState, setPushState] = useState<
        "granted" | "denied" | "default" | "unsupported"
    >(() =>
        isPushSupported()
            ? (Notification.permission as "granted" | "denied" | "default")
            : "unsupported",
    );
    const [pushBusy, setPushBusy] = useState(false);

    const enablePush = async () => {
        setPushBusy(true);
        try {
            const result = await requestPushPermission();
            if (result === "granted") {
                setPushState("granted");
                message.success("Notifications enabled on this device");
            } else if (result === "denied") {
                setPushState("denied");
                message.info(
                    "Blocked in this browser — allow notifications for this site in its site settings, then reload.",
                );
            } else if (result === "unsupported") {
                setPushState("unsupported");
            } else {
                message.warning(
                    "Permission granted, but the device could not register. It will retry on the next sign-in.",
                );
            }
        } finally {
            setPushBusy(false);
        }
    };

    if (!user) return <div>Not signed in</div>;

    const isDirty =
        firstName !== user.firstName ||
        lastName !== user.lastName ||
        email !== user.email ||
        timezone !== user.timezone;

    return (
        <div>
            <SettingsHeader
                title="Profile"
                description="Update your account information. Changes apply immediately across the workspace."
                actions={
                    <Button
                        type="primary"
                        icon={<Save size={14} strokeWidth={1.75} />}
                        loading={saveProfile.isPending}
                        disabled={!isDirty}
                        onClick={() => saveProfile.mutate()}
                    >
                        Save changes
                    </Button>
                }
            />

            <SettingsSection title="Identity">
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        paddingBottom: tokens.spacing[3],
                        borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                        marginBottom: tokens.spacing[2],
                    }}
                >
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            borderRadius: "50%",
                            background: tokens.colors.primary,
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 22,
                            fontWeight: 700,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        {user.firstName.charAt(0)}
                        {user.lastName.charAt(0)}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.base,
                                fontWeight: 600,
                            }}
                        >
                            {user.firstName} {user.lastName}
                        </div>
                        <div
                            style={{
                                fontSize: 12,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            {user.email} · {user.role}
                        </div>
                    </div>
                    <Button size="small">Change avatar</Button>
                </div>

                <SettingsFieldRow label="First name">
                    <Input
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                    />
                </SettingsFieldRow>
                <SettingsFieldRow label="Last name">
                    <Input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                    />
                </SettingsFieldRow>
                <SettingsFieldRow
                    label="Email"
                    hint="You'll need to verify a new email before it takes effect."
                >
                    <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </SettingsFieldRow>
            </SettingsSection>

            <SettingsSection
                title="Preferences"
                description="Personal display settings."
            >
                <SettingsFieldRow label="Timezone">
                    <Select
                        value={timezone}
                        onChange={setTimezone}
                        style={{ width: "100%" }}
                        options={TIMEZONES.map((t) => ({ value: t, label: t }))}
                    />
                </SettingsFieldRow>
            </SettingsSection>

            <SettingsSection
                title="Notifications"
                description="Get a desktop or phone alert the moment a task is assigned to you or passes its due date — even when this tab is closed. Asked for once per device; this is where you change your mind."
            >
                <Space align="center" size={12} wrap>
                    <Button
                        icon={<BellRing size={14} strokeWidth={1.75} />}
                        disabled={
                            pushState === "unsupported" ||
                            pushState === "denied" ||
                            pushState === "granted"
                        }
                        loading={pushBusy}
                        onClick={() => void enablePush()}
                    >
                        {pushState === "granted"
                            ? "Notifications on"
                            : "Enable notifications"}
                    </Button>
                    <span
                        style={{ fontSize: 12, color: tokens.colors.textMuted }}
                    >
                        {pushState === "granted" &&
                            "This device is registered."}
                        {pushState === "default" &&
                            "Not enabled on this device yet."}
                        {pushState === "denied" &&
                            "Blocked in this browser — allow notifications for this site in its site settings, then reload."}
                        {pushState === "unsupported" &&
                            "This browser can't receive them. On iPhone, add the site to your Home Screen first."}
                    </span>
                </Space>
            </SettingsSection>

            <SettingsSection
                title="Password"
                description="Change the password used to sign in."
            >
                <Button
                    icon={<KeyRound size={14} strokeWidth={1.75} />}
                    onClick={() => setPwOpen(true)}
                >
                    Change password
                </Button>
            </SettingsSection>

            <Modal
                title="Change password"
                open={pwOpen}
                onCancel={() => setPwOpen(false)}
                onOk={() => changePw.mutate()}
                okText="Update password"
                okButtonProps={{
                    disabled: !pwValid,
                    loading: changePw.isPending,
                }}
                destroyOnClose
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        marginTop: 12,
                    }}
                >
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 500 }}>
                            Current password
                        </label>
                        <Input.Password
                            value={currentPw}
                            onChange={(e) => setCurrentPw(e.target.value)}
                            placeholder="Current password"
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 500 }}>
                            New password
                        </label>
                        <Input.Password
                            value={newPw}
                            onChange={(e) => setNewPw(e.target.value)}
                            placeholder="At least 8 characters"
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 500 }}>
                            Confirm new password
                        </label>
                        <Input.Password
                            value={confirmPw}
                            onChange={(e) => setConfirmPw(e.target.value)}
                            placeholder="Re-type new password"
                        />
                        {confirmPw.length > 0 && newPw !== confirmPw && (
                            <div
                                style={{
                                    color: tokens.colors.danger,
                                    fontSize: 11,
                                    marginTop: 4,
                                }}
                            >
                                Passwords don't match
                            </div>
                        )}
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ProfileSettings;
