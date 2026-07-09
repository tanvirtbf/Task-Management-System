// @ts-nocheck — dead mock layer; excluded from typecheck in the original client tsconfig (exclude: src/mocks, src/lib/mock-api.ts)
import type { Note } from "../types/note";

export const notes: Note[] = [];
export const notesById = new Map<string, Note>();
export const notesByUser = (userId: string): Note[] =>
    notes.filter((n) => n.userId === userId);
