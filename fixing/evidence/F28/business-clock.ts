import { addBusinessMs, addBusinessDays, businessDayLengthMs } from "E:/Task Management System/server/src/utils/dhakaTime";
const cal = {
    workingDays: ["sun", "mon", "tue", "wed", "thu"],
    businessHoursStart: "09:00:00",
    businessHoursEnd: "18:00:00",
    timeZone: "Asia/Dhaka",
};
const dhaka = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", weekday: "short",
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
        .format(d);
const H = 3600_000;
console.log("  business day length: " + (businessDayLengthMs(cal)! / H) + "h");
const cases: [string, string][] = [
    ["2026-08-06T11:30:00Z", "Thu 17:30 Dhaka - 30 min before close, weekend next"],
    ["2026-08-06T03:00:00Z", "Thu 09:00 Dhaka - start of a working day"],
    ["2026-08-07T06:00:00Z", "Fri 12:00 Dhaka - a NON-working day"],
    ["2026-08-02T13:00:00Z", "Sun 19:00 Dhaka - after close"],
];
for (const [iso, label] of cases) {
    const t = new Date(iso);
    console.log("\n  filed " + dhaka(t) + "   (" + label + ")");
    console.log("    S0  2 business hours -> " + dhaka(addBusinessMs(t, 2 * H, cal))
        + "     [wall-clock was " + dhaka(new Date(t.getTime() + 2 * H)) + "]");
    console.log("    S1  1 business day   -> " + dhaka(addBusinessDays(t, 1, cal))
        + "     [wall-clock was " + dhaka(new Date(t.getTime() + 24 * H)) + "]");
    console.log("    S2  7 business days  -> " + dhaka(addBusinessDays(t, 7, cal))
        + "     [wall-clock was " + dhaka(new Date(t.getTime() + 7 * 24 * H)) + "]");
}
// degradation
console.log("\n  no working days configured -> falls back to wall clock: " +
    (addBusinessMs(new Date("2026-08-06T11:30:00Z"), 2 * H,
        { ...cal, workingDays: [] }).toISOString() === "2026-08-06T13:30:00.000Z"));
console.log("  inverted window          -> falls back to wall clock: " +
    (addBusinessMs(new Date("2026-08-06T11:30:00Z"), 2 * H,
        { ...cal, businessHoursStart: "18:00:00", businessHoursEnd: "09:00:00" })
        .toISOString() === "2026-08-06T13:30:00.000Z"));
