/**
 * Starter questions for the help assistant (AI_ASSISTANT_UPGRADE_PLAN.md P7 /
 * gap F3). Curated "most-common" set, kept out of the component so it can be
 * unit-tested and reused. A `deptOnly` question is shown only to users who can
 * actually reach the Department / Reports pages (owner/admin, or a Space Head).
 */
export interface Suggestion {
    q: string;
    deptOnly?: boolean;
}

export const SUGGESTIONS: Suggestion[] = [
    { q: "কীভাবে একটা নতুন task বানাবো?" },
    { q: "কাউকে task assign করব কীভাবে?" },
    { q: "Board / Calendar view কীভাবে দেখব?" },
    { q: "কীভাবে comment বা checklist যোগ করব?" },
    { q: "আমার আজকে কী কী কাজ due আছে?" },
    { q: "কীভাবে search করব?" },
    { q: "পাসওয়ার্ড কীভাবে বদলাবো?" },
    { q: "Department review আর weekly report কোথায়?", deptOnly: true },
];

/** The questions to show — `deptOnly` ones appear only when `canSeeDept`. */
export const pickSuggestions = (canSeeDept: boolean): string[] =>
    SUGGESTIONS.filter((s) => !s.deptOnly || canSeeDept).map((s) => s.q);
