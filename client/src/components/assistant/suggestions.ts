/**
 * Starter questions for the help assistant (AI_ASSISTANT_UPGRADE_PLAN.md P7 /
 * gap F3; re-gated on real permissions in AI_ASSISTANT_PERFECT_PLAN.md P7).
 *
 * Curated "most-common" set, kept out of the component so it can be unit-tested
 * and reused. Each question can declare what the person must be able to do
 * before it is worth offering — showing someone a starter question that leads
 * to a page they cannot open is a small betrayal of the whole point of the bot.
 */
export interface SuggestionAudience {
    /** Can reach Department / Reports (permission, or Head of a Space). */
    canSeeDept: boolean;
    /** Can open Roles & permissions. */
    canManageRoles: boolean;
    /** Heads at least one team (deep-plan P7 — the approvals "team" box). */
    isHead: boolean;
}

export interface Suggestion {
    q: string;
    /** Omitted = everyone sees it. */
    show?: (a: SuggestionAudience) => boolean;
}

export const SUGGESTIONS: Suggestion[] = [
    // Deep-plan P3/P5: the bot now ANSWERS these with live data — they lead,
    // because "ask instead of hunting" is the behaviour worth teaching.
    { q: "আমি কী কী task-এ assign আছি?" },
    { q: "আমার কোনো কাজ কি overdue হয়ে গেছে?" },
    { q: "আমার কাছে কি কোনো approval request pending আছে?" },
    { q: "কীভাবে একটা নতুন task বানাবো?" },
    { q: "কাউকে task assign করব কীভাবে?" },
    { q: "আমার team-এ কে কে আছে?" },
    { q: "কীভাবে comment বা checklist যোগ করব?" },
    { q: "পাসওয়ার্ড কীভাবে বদলাবো?" },
    {
        q: "আমার team-এর requests গুলোর কী অবস্থা?",
        show: (a) => a.isHead,
    },
    {
        q: "এই সপ্তাহের report ready হয়েছে?",
        show: (a) => a.canSeeDept,
    },
    {
        q: "Department review আর weekly report কোথায়?",
        show: (a) => a.canSeeDept,
    },
    {
        q: "কাউকে শুধু একটা department-এর access কীভাবে দেব?",
        show: (a) => a.canManageRoles,
    },
];

/** The questions worth showing this person. */
export const pickSuggestions = (audience: SuggestionAudience): string[] =>
    SUGGESTIONS.filter((s) => !s.show || s.show(audience)).map((s) => s.q);
