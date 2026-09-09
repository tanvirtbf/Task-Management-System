/**
 * The deadline, as an INSTANT — the client half of the rule P2 fixed on the
 * server.
 *
 * `due_date` is a calendar day and `due_time` an optional wall-clock time on
 * it. Neither carries a timezone. The server never turns them into an instant:
 * it compares day-to-day and clock-to-clock so `due_date` stays sargable in a
 * `WHERE` (see `server/src/utils/deadline.ts`, which explains why at length).
 * Saying "17 hours left" needs the instant, so this is where it gets built —
 * and the one thing that matters about it is that the two must never disagree.
 *
 * ── ⛔ the rule, restated so it can be checked against the server ────────────
 *
 *   due_time set   →  the deadline is that day at that time.
 *   due_time NULL  →  the deadline is the FIRST INSTANT OF THE NEXT DAY.
 *
 * That second line looks like a trick and is not. Plan §B1 says a date with no
 * time runs through the END of that day, and the server implements it as
 * `due_date < today` — a time-less task due today is not late at 23:59:59, and
 * becomes late as the next day begins. Midnight-tomorrow is that same boundary
 * written as an instant, which is what makes the countdown agree with the
 * bucket the task is actually in. `deadline.test.ts` checks that agreement
 * across a matrix rather than trusting this paragraph.
 *
 * ── the zone is the WORKSPACE's, not the browser's ──────────────────────────
 * `workspaces.timezone` decides what "5 PM" means, exactly as it decides what
 * "today" means server-side (F5). A viewer in another country sees the same
 * deadline as the person who set it; what changes is only how far away it is.
 */

/** Bangladesh is a permanent UTC+6 with no DST — the fallback, as server-side. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A zone's UTC offset in ms at a given instant.
 *
 * Mirrors `zoneOffsetMsAt` in `server/src/utils/dhakaTime.ts` — same technique,
 * because browsers ship full ICU too and a second technique is a second thing
 * to keep in step. Never throws: an unusable zone falls back to Dhaka, which is
 * this product's business default, rather than blanking a badge.
 */
const zoneOffsetMsAt = (utc: Date, timeZone: string): number => {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).formatToParts(utc);
        const get = (type: string): number =>
            Number(parts.find((p) => p.type === type)?.value ?? NaN);
        const asIfUtc = Date.UTC(
            get("year"),
            get("month") - 1,
            get("day"),
            get("hour") % 24, // some locales render midnight as "24"
            get("minute"),
            get("second"),
        );
        return Number.isNaN(asIfUtc) ? DHAKA_OFFSET_MS : asIfUtc - utc.getTime();
    } catch {
        return DHAKA_OFFSET_MS;
    }
};

/** A wall-clock reading in a zone → the UTC instant it names. */
const instantOfWallClock = (
    y: number,
    mo: number,
    d: number,
    h: number,
    mi: number,
    timeZone: string,
): Date => {
    const naive = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
    // Two passes. The offset has to be sampled at the instant we are solving
    // for, not at the naive one, and across a DST boundary those differ by the
    // very hour being corrected. One refinement settles it everywhere outside
    // the ambiguous hour itself. Dhaka has no DST, so for this deployment the
    // first pass is already exact and the second is insurance.
    const first = naive - zoneOffsetMsAt(new Date(naive), timeZone);
    return new Date(naive - zoneOffsetMsAt(new Date(first), timeZone));
};

/**
 * The moment this task becomes late, or null when it has no deadline.
 *
 * `dueDate` is `YYYY-MM-DD` (a bare wire date); `dueTime` is `HH:MM` or the
 * `HH:MM:SS` a TIME column hands back, or null.
 */
export const deadlineInstant = (
    dueDate: string | null | undefined,
    dueTime: string | null | undefined,
    timeZone: string,
): Date | null => {
    if (!dueDate) return null;
    const [y, mo, d] = dueDate.slice(0, 10).split("-").map(Number);
    if (!y || !mo || !d) return null;

    if (dueTime) {
        const [h, mi] = dueTime.slice(0, 5).split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(mi)) return null;
        return instantOfWallClock(y, mo, d, h, mi, timeZone);
    }
    // No time: due through the end of the day, so late at the next day's first
    // instant. `Date.UTC` normalises the 31st of a 30-day month for us.
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    return instantOfWallClock(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        0,
        0,
        timeZone,
    );
};

// ─── describing the gap ─────────────────────────────────────────────────────

export type DeadlineState =
    | "none"
    | "upcoming"
    | "soon"
    | "late"
    | "done_on_time"
    | "done_late";

export interface DeadlineDescription {
    state: DeadlineState;
    /** What the badge says: "17h left", "5h late", "done 5h late". */
    text: string;
    /** The full deadline for a tooltip, in the viewer's own locale. */
    title: string;
}

/** "Soon" is the last 24 hours — the window worth colouring differently. */
const SOON_MS = 24 * 60 * 60 * 1000;

/**
 * A gap in ms as the coarsest useful phrase.
 *
 * Days and hours, or hours and minutes, or minutes — never all three, and
 * never "0d 0h". The user asked for exactly these shapes: *"17 hours baki"* and
 * *"2 din 13 hours baki"*.
 */
const humanGap = (ms: number): string => {
    const total = Math.max(0, Math.floor(ms / 60000));
    const days = Math.floor(total / (60 * 24));
    const hours = Math.floor((total % (60 * 24)) / 60);
    const mins = total % 60;
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    // Under a minute still reads as a minute: "0m left" is not a deadline
    // anybody recognises, and the badge only ticks once a minute anyway.
    return `${Math.max(1, mins)}m`;
};

/**
 * What to say about a task's deadline right now.
 *
 * `now` is passed in rather than read, so every caller on a screen agrees and
 * a test can pin the clock. `completedAt` is the UTC instant the server
 * recorded; when it is set the answer stops moving — a finished task's
 * lateness is a fact about the past, not a countdown.
 */
export const describeDeadline = (input: {
    dueDate: string | null | undefined;
    dueTime: string | null | undefined;
    completedAt: string | null | undefined;
    timeZone: string;
    now: number;
}): DeadlineDescription => {
    const instant = deadlineInstant(input.dueDate, input.dueTime, input.timeZone);
    if (!instant) return { state: "none", text: "", title: "" };

    const target = instant.getTime();
    const title = new Date(target).toLocaleString();

    if (input.completedAt) {
        const done = new Date(input.completedAt).getTime();
        if (Number.isNaN(done)) return { state: "none", text: "", title };
        // `<` not `<=`: the deadline instant is the moment it becomes late, so
        // finishing exactly on it is late by the same rule the server uses.
        return done < target
            ? { state: "done_on_time", text: "done on time", title }
            : {
                  state: "done_late",
                  text: `done ${humanGap(done - target)} late`,
                  title,
              };
    }

    const remaining = target - input.now;
    if (remaining <= 0) {
        return { state: "late", text: `${humanGap(-remaining)} late`, title };
    }
    return {
        state: remaining <= SOON_MS ? "soon" : "upcoming",
        text: `${humanGap(remaining)} left`,
        title,
    };
};

/** Exported for the tests that check this client agrees with the server. */
export const DEADLINE_INTERNALS = { DAY_MS, SOON_MS, humanGap };
