import { useState } from "react";
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
import { getApiErrorMessage } from "../../http/client";
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

    // Re-seed the editable draft whenever a fresh workspace arrives (initial
    // load + post-save refetch) — adjust-during-render, not an effect.
    const [seededFrom, setSeededFrom] = useState<Workspace | null>(null);
    if (ws && ws !== seededFrom) {
        setSeededFrom(ws);
        setDraft(JSON.parse(JSON.stringify(ws)) as Workspace);
    }

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
        onError: (err) => message.error(getApiErrorMessage(err)),
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
                {/*
                 * F28 (ISS-028, decision D12.5). This Select used to be fully
                 * editable: you picked a locale, Save answered "Workspace
                 * saved", and the value was dropped by `workspaceToWire` before
                 * the request was even built — and would have been refused 422
                 * if it had arrived. Three layers disagreeing, with a success
                 * toast on top.
                 *
                 * Disabled rather than wired up, because nothing in the client
                 * reads a locale (there is no i18n layer), so a working control
                 * would just store a value with no consumer — the ISS-029
                 * defect this same phase is removing. The treatment copies
                 * "Workspace ID" twenty lines above: disabled, with a hint that
                 * says so.
                 */}
                <SettingsFieldRow
                    label="Default locale"
                    hint="Cannot be changed — the app ships in one locale."
                >
                    <Select
                        value={draft.settings.defaultLocale}
                        disabled
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
                {/*
                 * "Fiscal year starts in" was removed in F28 (ISS-029, D12.2).
                 * Its hint claimed "Used for fiscal-year reporting in
                 * dashboards" — there is no fiscal-year reporting anywhere in
                 * this product, and the column was read by no query, job or
                 * serializer. The control has been dropped along with the
                 * column (database/upgrades/012). The two settings above it
                 * survived the same audit because they gained a real consumer
                 * in this phase: working days and business hours now decide
                 * when an SLA deadline falls.
                 */}
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
