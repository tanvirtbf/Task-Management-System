import jwt from "jsonwebtoken";
import { getDb } from "../../src/db/client";
import { templates } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import type { Role } from "../../src/constants";
import type { TemplateStructure, TemplateType } from "../../src/types/templates";

/**
 * Shared helpers for the §23 Templates suite (mirrors `tests/forms/helpers.ts`).
 *
 * `seedTemplate` inserts a row directly via Drizzle (no endpoint dependency);
 * `setup` builds a workspace + a logged-in actor of a given role. All helpers
 * are workspace-scoped so tests stay isolated without a per-test truncate.
 */

export const TEMPLATES = "/api/v1/templates";

/** Wire-format `Template` per API_DESIGN.md §23 (snake_case top level). */
export interface WireTemplate {
    id: string;
    workspace_id: string;
    type: string;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    structure: TemplateStructure;
    usage_count: number;
    created_by: string;
    created_at: string;
    updated_at: string;
}

let _seq = 0;

/** A structure that passes create validation (≥1 checklist item). */
export const validStructure = (
    overrides: Partial<TemplateStructure> = {},
): TemplateStructure => ({
    checklistName: "Playbook",
    checklistItems: [
        { text: "First step", dueOffsetDays: 0 },
        { text: "Second step", dueOffsetDays: 2 },
    ],
    ...overrides,
});

export interface SeedTemplateInput {
    workspaceId: string;
    createdBy: string;
    name?: string;
    type?: TemplateType;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    structure?: TemplateStructure;
    usageCount?: number;
    createdAt?: Date;
}

/** Insert a templates row directly. `(workspace_id, name)` is UNIQUE. */
export const seedTemplate = async (input: SeedTemplateInput) => {
    const db = getDb();
    const id = fakeId("tpl");
    const seq = ++_seq;
    const name = input.name ?? `Template ${seq}`;
    const values: typeof templates.$inferInsert = {
        id,
        workspaceId: input.workspaceId,
        type: input.type ?? "task",
        name,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        structure: input.structure ?? validStructure(),
        usageCount: input.usageCount ?? 0,
        createdBy: input.createdBy,
    };
    if (input.createdAt !== undefined) values.createdAt = input.createdAt;
    await db.insert(templates).values(values);
    return { id, name, workspaceId: input.workspaceId };
};

/** Workspace + a logged-in actor of the given role (default admin). */
export const setup = async (role: Role = "admin") => {
    const ws = await makeWorkspace();
    const actor = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(actor);
    return { ws, actor, client };
};

/** Mint a raw access token for the negative-auth cases. */
export const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", ...opts },
    );

export const dataOf = (body: unknown): WireTemplate[] =>
    (body as { data: WireTemplate[] }).data;

export const namesOf = (body: unknown): string[] =>
    dataOf(body).map((t) => t.name);
