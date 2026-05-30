import type { Logger } from "winston";
import { AppError } from "../errors";
import { fakeId } from "../utils";
import { ListsRepo } from "../repositories/ListsRepo";
import { StatusesRepo, type StatusRecord } from "../repositories/StatusesRepo";

export interface ListStatusesInput {
    listId: string;
    workspaceId: string;
}

export interface CreateStatusInput {
    listId: string;
    workspaceId: string;
    name: string;
    statusGroup: StatusRecord["statusGroup"];
    color?: string;
    /** When omitted, the new status is appended to the end of the list. */
    position?: number;
}

export interface UpdateStatusInput {
    id: string;
    workspaceId: string;
    name?: string;
    color?: string;
    statusGroup?: StatusRecord["statusGroup"];
}

/**
 * True when a Drizzle/mysql2 error is a UNIQUE/PK violation (MySQL errno 1062 /
 * `ER_DUP_ENTRY`). Lets `createForList` translate a `uq_statuses_scope_name`
 * collision into `409 status.duplicate` without a TOCTOU pre-check — the insert
 * is the race-safe arbiter.
 */
const isDuplicateKeyError = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ER_DUP_ENTRY";

/**
 * §7 Statuses domain logic. Controllers translate HTTP; this service owns the
 * read flow and the workspace-isolation guard.
 */
export class StatusesService {
    constructor(
        private lists: ListsRepo,
        private statuses: StatusesRepo,
        private logger: Logger,
    ) {}

    /**
     * Return every status configured for a list the caller's workspace owns.
     * The list is resolved within the workspace first: a missing or
     * cross-workspace id yields `404 list.not_found` — never another
     * workspace's data, and never a misleading empty `200`.
     */
    async listByList(input: ListStatusesInput): Promise<StatusRecord[]> {
        const list = await this.lists.findByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            this.logger.debug("statuses.list_by_list.list_not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        return this.statuses.listByList(input.listId);
    }

    /**
     * Add a status to a list the caller's workspace owns. The list is resolved
     * within the workspace first: a missing or cross-workspace id yields
     * `404 list.not_found` (no cross-tenant existence oracle). When `position`
     * is omitted the status is appended to the end of the list. A duplicate name
     * within the list (`uq_statuses_scope_name`, case-insensitive) becomes
     * `409 status.duplicate`.
     */
    async createForList(input: CreateStatusInput): Promise<StatusRecord> {
        const list = await this.lists.findByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            this.logger.debug("statuses.create.list_not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        const position =
            input.position !== undefined
                ? input.position
                : await this.statuses.nextPosition(input.listId);

        try {
            return await this.statuses.create({
                id: fakeId("st"),
                scopeId: input.listId,
                name: input.name,
                statusGroup: input.statusGroup,
                position,
                color: input.color,
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "status.duplicate",
                    `A status named "${input.name}" already exists in this list`,
                );
            }
            throw err;
        }
    }

    /**
     * Update a status the caller's workspace owns. The status is resolved within
     * the workspace first (joined through its list's space): a missing or
     * cross-workspace id yields `404 status.not_found` — the write that follows
     * is keyed on the PK alone, so this gate is the sole isolation control. A
     * `name` rename that collides with another status in the same list
     * (`uq_statuses_scope_name`, case-insensitive) becomes `409 status.duplicate`.
     * At least one updatable field is guaranteed present by the controller.
     */
    async updateById(input: UpdateStatusInput): Promise<StatusRecord> {
        const existing = await this.statuses.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        if (!existing) {
            this.logger.debug("statuses.update.not_found", {
                statusId: input.id,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "status.not_found",
                `Status ${input.id} does not exist`,
            );
        }

        let updated: StatusRecord | null;
        try {
            updated = await this.statuses.update(input.id, {
                name: input.name,
                color: input.color,
                statusGroup: input.statusGroup,
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "status.duplicate",
                    `A status named "${input.name}" already exists in this list`,
                );
            }
            throw err;
        }

        if (!updated) {
            // The row vanished between the isolation gate and the write (a
            // concurrent delete) — surface a 404, not a 500.
            throw AppError.notFound(
                "status.not_found",
                `Status ${input.id} does not exist`,
            );
        }
        return updated;
    }
}
