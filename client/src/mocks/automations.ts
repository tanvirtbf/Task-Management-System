import type { Automation, AutomationRun } from "../types/automation";

export const automations: Automation[] = [];
export const automationsById = new Map<string, Automation>();
export const automationsByList = (_listId: string): Automation[] => [];
export const automationRuns: AutomationRun[] = [];
export const runsByAutomation = (_id: string): AutomationRun[] => [];
