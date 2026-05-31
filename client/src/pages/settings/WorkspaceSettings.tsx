import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Input,
    Select,
    TimePicker,
    App as AntApp,
    Checkbox,
} from "antd";
import dayjs from "dayjs";
import { Save } from "lucide-react";
import { workspaceApi } from "../../http/api";
import {
    SettingsHeader,
    SettingsSection,
    SettingsFieldRow,
} from "../../components/settings/SettingsHeader";
import { LoadingState } from "../../components/shared/LoadingState";
import { tokens } from "../../theme";
import type { Workspace } from "../../types";

const TIMEZONES = [
    "Asia/Dhaka",
    "Asia/Kolkata",
    "Asia/Karachi",
    "Asia/Singapore",
    "Asia/Dubai",
    "UTC",
    "Europe/London",
    "America/New_York",
    "America/Los_Angeles",
];

const LOCALES = [
    { value: "en-US", label: "English (United States)" },
    { value: "en-GB", label: "English (United Kingdom)" },
    { value: "bn-BD", label: "Bangla (Bangladesh)" },
    { value: "hi-IN", label: "Hindi (India)" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const WorkspaceSettings = () => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const { data: ws } = useQuery({
        queryKey: ["workspace"],
        queryFn: () => workspaceApi.get(),
    });

    const [draft, setDraft] = useState<Workspace | null>(null);

    useEffect(() => {
        if (ws) setDraft(JSON.parse(JSON.stringify(ws)));
    }, [ws]);

    const save = useMutation({
        mutationFn: () =>
            draft
                ? workspaceApi.update({
                      name: draft.name,
                      settings: draft.settings,
                  })
                : Promise.reject(),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["workspace"] });
            message.success("Workspace saved");
        },
    });

    if (!draft || !ws) return <LoadingState />;

    const isDirty = JSON.stringify(draft) !== JSON.stringify(ws);

    return (
        <div>
            <SettingsHeader
                title="Workspace"
                description="General settings that apply to everyone in this workspace."
                actions={
                    <Button
                        type="primary"
                        icon={<Save size={14} strokeWidth={1.75} />}
                        loading={save.isPending}
                        disabled={!isDirty}
                        onClick={() => save.mutate()}
                    >
                        Save changes
                    </Button>
                }
            />

            <SettingsSection title="Identity">
                <SettingsFieldRow label="Workspace name">
                    <Input
                        value={draft.name}
                        onChange={(e) =>
                            setDraft({ ...draft, name: e.target.value })
                        }
                    />
                </SettingsFieldRow>
                <SettingsFieldRow
                    label="Workspace ID"
                    hint="Used in URLs and API calls — cannot be changed."
                >
                    <Input
                        value={draft.id}
                        disabled
                        style={{
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    />
                </SettingsFieldRow>
            </SettingsSection>

            <SettingsSection title="Locale & timezone">
                <SettingsFieldRow label="Default timezone">
                    <Select
                        value={draft.settings.timezone}
                        onChange={(v) =>
                            setDraft({
                                ...draft,
                                settings: { ...draft.settings, timezone: v },
                            })
                        }
                        style={{ width: "100%" }}
                        options={TIMEZONES.map((t) => ({
                            value: t,
                            label: t,
                        }))}
                    />
                </SettingsFieldRow>
                <SettingsFieldRow label="Default locale">
                    <Select
                        value={draft.settings.defaultLocale}
                        onChange={(v) =>
                            setDraft({
                                ...draft,
                                settings: {
                                    ...draft.settings,
                                    defaultLocale: v,
                                },
                            })
                        }
                        style={{ width: "100%" }}
                        options={LOCALES}
                    />
                </SettingsFieldRow>
                <SettingsFieldRow
                    label="Week starts on"
                    hint="Affects calendar, gantt, and analytics."
                >
                    <Select
                        value={draft.settings.weekStartsOn}
                        onChange={(v) =>
                            setDraft({
                                ...draft,
                                settings: {
                                    ...draft.settings,
                                    weekStartsOn: v,
                                },
                            })
                        }
                        style={{ width: "100%" }}
                        options={DAYS.map((d, i) => ({
                            value: i,
                            label: d,
                        }))}
                    />
                </SettingsFieldRow>
            </SettingsSection>

            <SettingsSection
                title="Working hours"
                description="Used by workload, dashboards, and SLA calculations."
            >
                <SettingsFieldRow label="Working days">
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                        }}
                    >
                        {DAYS.map((d, i) => (
                            <Checkbox
                                key={i}
                                checked={draft.settings.workingDays.includes(i)}
                                onChange={(e) => {
                                    const next = e.target.checked
                                        ? [
                                              ...draft.settings.workingDays,
                                              i,
                                          ].sort((a, b) => a - b)
                                        : draft.settings.workingDays.filter(
                                              (x) => x !== i,
                                          );
                                    setDraft({
                                        ...draft,
                                        settings: {
                                            ...draft.settings,
                                            workingDays: next,
                                        },
                                    });
                                }}
                            >
                                {d}
                            </Checkbox>
                        ))}
                    </div>
                </SettingsFieldRow>
                <SettingsFieldRow label="Business hours">
                    <div style={{ display: "flex", gap: 12 }}>
                        <TimePicker
                            value={dayjs(
                                draft.settings.businessHours.start,
                                "HH:mm",
                            )}
                            format="HH:mm"
                            onChange={(t) =>
                                t &&
                                setDraft({
                                    ...draft,
                                    settings: {
                                        ...draft.settings,
                                        businessHours: {
                                            ...draft.settings.businessHours,
                                            start: t.format("HH:mm"),
                                        },
                                    },
                                })
                            }
                        />
                        <span style={{ alignSelf: "center" }}>to</span>
                        <TimePicker
                            value={dayjs(
                                draft.settings.businessHours.end,
                                "HH:mm",
                            )}
                            format="HH:mm"
                            onChange={(t) =>
                                t &&
                                setDraft({
                                    ...draft,
                                    settings: {
                                        ...draft.settings,
                                        businessHours: {
                                            ...draft.settings.businessHours,
                                            end: t.format("HH:mm"),
                                        },
                                    },
                                })
                            }
                        />
                    </div>
                </SettingsFieldRow>
                <SettingsFieldRow
                    label="Fiscal year starts in"
                    hint="Used for fiscal-year reporting in dashboards."
                >
                    <Select
                        value={draft.settings.fiscalYearStartMonth ?? 1}
                        onChange={(v) =>
                            setDraft({
                                ...draft,
                                settings: {
                                    ...draft.settings,
                                    fiscalYearStartMonth: v,
                                },
                            })
                        }
                        style={{ width: "100%" }}
                        options={[
                            "January",
                            "February",
                            "March",
                            "April",
                            "May",
                            "June",
                            "July",
                            "August",
                            "September",
                            "October",
                            "November",
                            "December",
                        ].map((m, i) => ({ value: i + 1, label: m }))}
                    />
                </SettingsFieldRow>
            </SettingsSection>

            <SettingsSection
                title="Danger zone"
                description="Irreversible actions — proceed with caution."
            >
                <Button danger>Delete workspace</Button>
            </SettingsSection>
        </div>
    );
};

export default WorkspaceSettings;
