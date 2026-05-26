import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Square, Plus } from "lucide-react";
import { App as AntApp, Popover, Input, Button, InputNumber } from "antd";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";
import type { Task } from "../../types";

const formatHMS = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, "0")}:${m
        .toString()
        .padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};

const formatHM = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
};

/** Per-(user, task) timer state in localStorage so it survives reload. */
interface TimerState {
    taskId: string;
    startedAt: number;
}

const TIMER_KEY = "tms.active-timer";

const readTimer = (): TimerState | null => {
    try {
        const raw = localStorage.getItem(TIMER_KEY);
        return raw ? (JSON.parse(raw) as TimerState) : null;
    } catch {
        return null;
    }
};
const writeTimer = (s: TimerState | null) => {
    try {
        if (s) localStorage.setItem(TIMER_KEY, JSON.stringify(s));
        else localStorage.removeItem(TIMER_KEY);
    } catch {
        // ignore
    }
};

interface Props {
    task: Task;
}

export const TimeTrackingControl = ({ task }: Props) => {
    const user = useAuthStore((s) => s.user);
    const { message } = AntApp.useApp();
    const qc = useQueryClient();
    const [timer, setTimer] = useState<TimerState | null>(() => {
        const t = readTimer();
        return t && t.taskId === task.id ? t : null;
    });
    const [tick, setTick] = useState(0);
    const [manualOpen, setManualOpen] = useState(false);

    // Re-render every second while a timer is active
    useEffect(() => {
        if (!timer) return;
        const id = window.setInterval(() => setTick((x) => x + 1), 1000);
        return () => window.clearInterval(id);
    }, [timer]);

    // Reset state if the active timer was started on a different task
    useEffect(() => {
        const t = readTimer();
        if (t && t.taskId !== task.id) setTimer(null);
        else if (t && t.taskId === task.id) setTimer(t);
        else setTimer(null);
    }, [task.id]);

    const elapsed = useMemo(() => {
        if (!timer) return 0;
        return Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000));
    }, [timer, tick]);

    const log = useMutation({
        mutationFn: (input: { durationSeconds: number; note?: string }) =>
            user
                ? mockApi.timeTracking.log({
                      taskId: task.id,
                      userId: user.id,
                      durationSeconds: input.durationSeconds,
                      note: input.note,
                  })
                : Promise.reject(new Error("Not signed in")),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["time-logs", task.id] });
            qc.invalidateQueries({ queryKey: ["task", task.id] });
            qc.invalidateQueries({
                queryKey: ["tasks-by-list", task.primaryListId],
            });
        },
    });

    const startTimer = () => {
        const existing = readTimer();
        if (existing && existing.taskId !== task.id) {
            message.warning(
                "A timer is already running on another task. Stop it first.",
            );
            return;
        }
        const s = { taskId: task.id, startedAt: Date.now() };
        writeTimer(s);
        setTimer(s);
    };

    const stopTimer = () => {
        if (!timer) return;
        const duration = Math.max(
            1,
            Math.floor((Date.now() - timer.startedAt) / 1000),
        );
        writeTimer(null);
        setTimer(null);
        log.mutate(
            { durationSeconds: duration },
            {
                onSuccess: () =>
                    message.success(`Logged ${formatHM(duration)}`),
            },
        );
    };

    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontFamily: tokens.typography.fontFamilyMono,
            }}
        >
            <span
                style={{
                    fontWeight: 600,
                    color: timer
                        ? tokens.colors.primary
                        : tokens.colors.textSecondary,
                    fontVariantNumeric: "tabular-nums",
                }}
            >
                {timer
                    ? formatHMS(elapsed)
                    : formatHM(task.timeTrackedSeconds || 0)}
            </span>
            {timer ? (
                <Button
                    type="primary"
                    danger
                    size="small"
                    icon={<Square size={11} strokeWidth={1.75} />}
                    onClick={stopTimer}
                >
                    Stop
                </Button>
            ) : (
                <Button
                    type="primary"
                    size="small"
                    icon={<Play size={11} strokeWidth={1.75} />}
                    onClick={startTimer}
                >
                    Start
                </Button>
            )}
            <ManualEntryPopover
                open={manualOpen}
                onOpenChange={setManualOpen}
                onSubmit={(durationSeconds, note) => {
                    log.mutate(
                        { durationSeconds, note },
                        {
                            onSuccess: () => {
                                message.success(
                                    `Logged ${formatHM(durationSeconds)}`,
                                );
                                setManualOpen(false);
                            },
                        },
                    );
                }}
            />
        </div>
    );
};

const ManualEntryPopover = ({
    open,
    onOpenChange,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onSubmit: (durationSeconds: number, note?: string) => void;
}) => {
    const [hours, setHours] = useState<number>(0);
    const [minutes, setMinutes] = useState<number>(30);
    const [note, setNote] = useState("");

    const total = hours * 3600 + minutes * 60;

    return (
        <Popover
            open={open}
            onOpenChange={onOpenChange}
            trigger="click"
            placement="bottomLeft"
            title="Log time manually"
            content={
                <div
                    style={{
                        width: 260,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                            <Label>Hours</Label>
                            <InputNumber
                                min={0}
                                max={24}
                                value={hours}
                                onChange={(v) => setHours(Number(v) || 0)}
                                style={{ width: "100%" }}
                                size="small"
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <Label>Minutes</Label>
                            <InputNumber
                                min={0}
                                max={59}
                                value={minutes}
                                onChange={(v) => setMinutes(Number(v) || 0)}
                                style={{ width: "100%" }}
                                size="small"
                            />
                        </div>
                    </div>
                    <div>
                        <Label>Note (optional)</Label>
                        <Input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="What did you work on?"
                            size="small"
                        />
                    </div>
                    <div
                        style={{
                            display: "flex",
                            gap: 6,
                            justifyContent: "flex-end",
                        }}
                    >
                        <Button
                            size="small"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="primary"
                            size="small"
                            disabled={total <= 0}
                            onClick={() => onSubmit(total, note || undefined)}
                        >
                            Log time
                        </Button>
                    </div>
                </div>
            }
        >
            <Button
                size="small"
                type="text"
                icon={<Plus size={11} strokeWidth={1.75} />}
                aria-label="Log time manually"
                title="Log time manually"
            />
        </Popover>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
    <label
        style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            color: tokens.colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 4,
        }}
    >
        {children}
    </label>
);
