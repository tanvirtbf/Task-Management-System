import type { Template } from "../types/template";

export const templates: Template[] = [];
export const templatesById = new Map<string, Template>();
export const templatesByType = (_type: string): Template[] => [];
