import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import {
    TaskTypesRepo,
    type TaskTypeRecord,
    type TaskTypeUpdateRow,
} from "../repositories/TaskTypesRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { fakeId } from "../utils";

/**
 * §8 Task types business logic. The list endpoint is a single workspace-scoped
 * read; `create` and `update` own their transaction + `workspace_activity`
 * write.
 */

export interface CreateTaskTypeInput {
    workspaceId: string;
    actorId: string;
    name: string;
    /** Omitted (`undefined`) fields fall through to the column DEFAULT / NULL. */
    description?: string;
    icon?: string;
    color?: string;
    isMilestoneType?: boolean;
    isDevType?: boolean;
}

export interface UpdateTaskTypeInput {
    workspaceId: string;
    actorId: string;
    id: string;
    /** Only the keys the client sent; `description: null` clears the field. */
    patch: TaskTypeUpdateRow;
}

/**
 * Fields a seeded `is_system` task type does NOT allow changing. Per
 * API_DESIGN.md §8 only `icon`/`color`/`description` are mutable on system
 * types; touching any of these is rejected with `403 task_type.system`.
 */
const SYSTEM_LOCKED_FIELDS = [
    "name",
    "isMilestoneType",
    "isDevType",
] as const satisfies ReadonlyArray<keyof TaskTypeUpdateRow>;

/** True for the mysql2 unique-constraint violation (errno 1062). */
const isDuplicateKeyError = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ER_DUP_ENTRY";

export class TaskTypeService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private taskTypes: TaskTypesRepo,
        private workspaceActivity: WorkspaceActivityRepo,
    ) {}

    /**
     * List every task type in a workspace. The `workspaceId` always comes from
     * the caller's verified JWT (`req.auth.workspaceId`) — never from client
     * input — so there is no cross-tenant read path.
     */
    async list(workspaceId: string): Promise<TaskTypeRecord[]> {
        return this.taskTypes.listByWorkspace(workspaceId);
    }

    /**
     * Create a task type in the caller's workspace.
     *
     * The new type is appended at the end (`position = max + 1`); `id` is
     * server-minted and `is_system` is always false. The insert and the
     * `workspace_activity` row are one transaction, so a duplicate name
     * (`(workspace_id, name)` is UNIQUE — case-insensitive under the
     * `utf8mb4_unicode_ci` collation) rolls everything back and surfaces as
     * `409 task_type.duplicate`.
     */
    async create(input: CreateTaskTypeInput): Promise<TaskTypeRecord> {
        const id = fakeId("tt");

        try {
            return await this.db.transaction(async (tx) => {
                const position = await this.taskTypes.nextPosition(
                    input.workspaceId,
                    tx,
                );

                const record = await this.taskTypes.create(
                    {
                        id,
                        workspaceId: input.workspaceId,
                        name: input.name,
                        position,
                        description: input.description,
                        icon: input.icon,
                        color: input.color,
                        isMilestoneType: input.isMilestoneType,
                        isDevType: input.isDevType,
                    },
                    tx,
                );

                await this.workspaceActivity.record(
                    {
                        workspaceId: input.workspaceId,
                        actorId: input.actorId,
                        entityType: "task_type",
                        entityId: id,
                        action: "created",
                        context: { name: input.name },
                    },
                    tx,
                );

                return record;
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "task_type.duplicate",
                    `A task type named "${input.name}" already exists in this workspace`,
                );
            }
            throw err;
        }
    }

    /**
     * Apply a partial update to a task type in the caller's workspace.
     *
     * Rejects an empty patch (422), a missing/cross-tenant id (404
     * `task_type.not_found`), and a locked-field edit on a system type (403
     * `task_type.system`). The row is locked for the transaction so a
     * concurrent update/delete serialises; the update and the
     * `workspace_activity` row commit together, and a rename collision surfaces
     * as `409 task_type.duplicate`.
     */
    async update(input: UpdateTaskTypeInput): Promise<TaskTypeRecord> {
        const { workspaceId, actorId, id, patch } = input;

        const changedFields = Object.keys(patch);
        if (changedFields.length === 0) {
            throw AppError.validationFailed([
                { issue: "Provide at least one field to update" },
            ]);
        }

        try {
            return await this.db.transaction(async (tx) => {
                const existing = await this.taskTypes.findByIdInWorkspace(
                    id,
                    workspaceId,
                    tx,
                    { forUpdate: true },
                );
                if (!existing) {
                    throw AppError.notFound(
                        "task_type.not_found",
                        `Task type ${id} does not exist`,
                    );
                }

                if (
                    existing.isSystem &&
                    SYSTEM_LOCKED_FIELDS.some((field) => field in patch)
                ) {
                    throw AppError.forbidden(
                        "task_type.system",
                        "System task types allow only icon, color, and description changes",
                    );
                }

                const record = await this.taskTypes.update(id, patch, tx);

                await this.workspaceActivity.record(
                    {
                        workspaceId,
                        actorId,
                        entityType: "task_type",
                        entityId: id,
                        action: "updated",
                        context: { fields: changedFields },
                    },
                    tx,
                );

                return record;
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "task_type.duplicate",
                    `A task type named "${patch.name}" already exists in this workspace`,
                );
            }
            throw err;
        }
    }
}
