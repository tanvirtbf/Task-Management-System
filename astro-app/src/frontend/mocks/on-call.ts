import type { OnCallShift } from "../types/on-call";

const monday = (offsetWeeks: number): string => {
    const d = new Date();
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + mondayOffset + offsetWeeks * 7);
    return d.toISOString().slice(0, 10);
};

export const onCallShifts: OnCallShift[] = [
    { id: "oc-w-1", weekStart: monday(-1), engineerId: "u-002" },
    { id: "oc-w0", weekStart: monday(0), engineerId: "u-003" },
    { id: "oc-w1", weekStart: monday(1), engineerId: "u-004" },
    { id: "oc-w2", weekStart: monday(2), engineerId: "u-005" },
    { id: "oc-w3", weekStart: monday(3), engineerId: "u-002" },
];

export const currentOnCallEngineerId = (): string => {
    const thisMonday = monday(0);
    return (
        onCallShifts.find((s) => s.weekStart === thisMonday)?.engineerId ??
        "u-002"
    );
};
