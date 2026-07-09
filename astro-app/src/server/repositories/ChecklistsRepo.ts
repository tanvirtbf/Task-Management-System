import { asc, desc, eq, inArray } from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { checklistItems, checklists } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for §15 Checklists (`checklists` + `checklist_items`). Deleting a
 * checklist cascades to its items via the FK, so there is no manual item cleanup.
 * The `tasks.subtasks_count` / `subtasks_completed` counters are trigger-
 * maintained off item state, so this repo never touches them. Workspace
 * isolation is enforced one level up (the service resolves the owning task in the
 * caller's workspace before any write).
 */

export interface ChecklistRow {
    id: string;
    taskId: string;
    name: string;
    position: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface ChecklistItemRow {
    id: string;
    checklistId: string;
    parentItemId: string | null;
    text: string;
    isCompleted: boolean;
    completedAt: Date | null;
    completedBy: string | null;
    assigneeId: string | null;
    position: number;
    createdAt: Date;
}

export interface NewChecklistInput {
    taskId: string;
    name: string;
    position: number;
}

export interface NewItemInput {
    checklistId: string;
    text: string;
    parentItemId?: string | null;
    assigneeId?: string | null;
    position: number;
}

const CHECKLIST_COLUMNS = {
    id: checklists.id,
    taskId: checklists.taskId,
    name: checklists.name,
    position: checklists.position,
    createdAt: checklists.createdAt,
    updatedAt: checklists.updatedAt,
} as const;

const ITEM_COLUMNS = {
    id: checklistItems.id,
    checklistId: checklistItems.checklistId,
    parentItemId: checklistItems.parentItemId,
    text: checklistItems.text,
    isCompleted: checklistItems.isCompleted,
    completedAt: checklistItems.completedAt,
    completedBy: checklistItems.completedBy,
    assigneeId: checklistItems.assigneeId,
    position: checklistItems.position,
    createdAt: checklistItems.createdAt,
} as const;

export class ChecklistsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    // ─── checklists ────────────────────────────────────────────────────────────

    /** A task's checklists, position-ordered (created_at tie-break). */
    async listByTask(taskId: string): Promise<ChecklistRow[]> {
        return this.db
            .select(CHECKLIST_COLUMNS)
            .from(checklists)
            .where(eq(checklists.taskId, taskId))
            .orderBy(asc(checklists.position), asc(checklists.createdAt));
    }

    async findChecklistById(id: string): Promise<ChecklistRow | null> {
        const [row] = await this.db
            .select(CHECKLIST_COLUMNS)
            .from(checklists)
            .where(eq(checklists.id, id))
            .limit(1);
        return row ?? null;
    }

    /** Append position = (max for this task) + 1 — keeps new checklists last. */
    async nextChecklistPosition(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [top] = await exec
            .select({ position: checklists.position })
            .from(checklists)
            .where(eq(checklists.taskId, taskId))
            .orderBy(desc(checklists.position))
            .limit(1);
        return (top?.position ?? -1) + 1;
    }

    async insertChecklist(
        input: NewChecklistInput,
        exec: DbExecutor = this.db,
    ): Promise<ChecklistRow> {
        const id = fakeId("ch");
        await exec.insert(checklists).values({
            id,
            taskId: input.taskId,
            name: input.name,
            position: input.position,
        });
        const [row] = await exec
            .select(CHECKLIST_COLUMNS)
            .from(checklists)
            .where(eq(checklists.id, id))
            .limit(1);
        if (!row) throw new Error("checklist insert did not persist");
        return row;
    }

    async updateChecklist(
        id: string,
        patch: { name?: string; position?: number },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.update(checklists).set(patch).where(eq(checklists.id, id));
    }

    /** Delete a checklist — items cascade via `fk` (ON DELETE CASCADE). */
    async deleteChecklist(id: string, exec: DbExecutor = this.db): Promise<void> {
        await exec.delete(checklists).where(eq(checklists.id, id));
    }

    // ─── checklist_items ───────────────────────────────────────────────────────

    /** Items across many checklists, position-ordered — feeds the GET read. */
    async listItemsByChecklistIds(
        checklistIds: string[],
    ): Promise<ChecklistItemRow[]> {
        if (checklistIds.length === 0) return [];
        return this.db
            .select(ITEM_COLUMNS)
            .from(checklistItems)
            .where(inArray(checklistItems.checklistId, checklistIds))
            .orderBy(
                asc(checklistItems.position),
                asc(checklistItems.createdAt),
            );
    }

    async findItemById(id: string): Promise<ChecklistItemRow | null> {
        const [row] = await this.db
            .select(ITEM_COLUMNS)
            .from(checklistItems)
            .where(eq(checklistItems.id, id))
            .limit(1);
        return row ?? null;
    }

    async nextItemPosition(
        checklistId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [top] = await exec
            .select({ position: checklistItems.position })
            .from(checklistItems)
            .where(eq(checklistItems.checklistId, checklistId))
            .orderBy(desc(checklistItems.position))
            .limit(1);
        return (top?.position ?? -1) + 1;
    }

    async insertItem(
        input: NewItemInput,
        exec: DbExecutor = this.db,
    ): Promise<ChecklistItemRow> {
        const id = fakeId("ci");
        await exec.insert(checklistItems).values({
            id,
            checklistId: input.checklistId,
            text: input.text,
            parentItemId: input.parentItemId ?? null,
            assigneeId: input.assigneeId ?? null,
            position: input.position,
        });
        const [row] = await exec
            .select(ITEM_COLUMNS)
            .from(checklistItems)
            .where(eq(checklistItems.id, id))
            .limit(1);
        if (!row) throw new Error("checklist item insert did not persist");
        return row;
    }

    /** Atomic bulk insert; returns the persisted rows, position-ordered. */
    async insertItems(
        inputs: NewItemInput[],
        exec: DbExecutor = this.db,
    ): Promise<ChecklistItemRow[]> {
        if (inputs.length === 0) return [];
        const rows = inputs.map((input) => ({
            id: fakeId("ci"),
            checklistId: input.checklistId,
            text: input.text,
            parentItemId: input.parentItemId ?? null,
            assigneeId: input.assigneeId ?? null,
            position: input.position,
        }));
        await exec.insert(checklistItems).values(rows);
        const ids = rows.map((r) => r.id);
        return exec
            .select(ITEM_COLUMNS)
            .from(checklistItems)
            .where(inArray(checklistItems.id, ids))
            .orderBy(asc(checklistItems.position));
    }

    async updateItem(
        id: string,
        patch: { text?: string; assigneeId?: string | null; position?: number },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(checklistItems)
            .set(patch)
            .where(eq(checklistItems.id, id));
    }

    /** Set/clear the checkbox state in one shot (toggle). */
    async setItemCompletion(
        id: string,
        state: {
            isCompleted: boolean;
            completedAt: Date | null;
            completedBy: string | null;
        },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(checklistItems)
            .set(state)
            .where(eq(checklistItems.id, id));
    }

    async deleteItem(id: string, exec: DbExecutor = this.db): Promise<void> {
        await exec.delete(checklistItems).where(eq(checklistItems.id, id));
    }
}
