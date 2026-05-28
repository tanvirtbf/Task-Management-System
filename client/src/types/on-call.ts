/**
 * On-call rotation — which engineer is the first-responder this week.
 */

export interface OnCallShift {
    id: string;
    /** ISO date (Monday) — the week this engineer is on call. */
    weekStart: string;
    engineerId: string;
}
