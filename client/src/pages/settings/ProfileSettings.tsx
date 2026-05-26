import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select, App as AntApp } from "antd";
import { Save, KeyRound } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
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
                ? mockApi.users.updateProfile(user.id, {
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
                title="Password"
                description="Change the password used to sign in."
            >
                <Button icon={<KeyRound size={14} strokeWidth={1.75} />}>
                    Change password
                </Button>
            </SettingsSection>
        </div>
    );
};

export default ProfileSettings;
