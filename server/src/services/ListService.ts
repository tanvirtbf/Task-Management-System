import type { Logger } from "winston";
import { AppError } from "../errors";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { ListsRepo, type ListRecord } from "../repositories/ListsRepo";

export interface ListBySpaceInput {
    spaceId: string;
    workspaceId: string;
    includeArchived: boolean;
}

export interface ListAllInput {
    workspaceId: string;
    spaceId?: string;
    includeArchived: boolean;
}

export interface GetListInput {
    listId: string;
    workspaceId: string;
}

/**
 * §6 Lists domain logic. Controllers translate HTTP; this service owns the
 * read flow and the workspace-isolation guard.
 */
export class ListService {
    constructor(
        private spaces: SpacesRepo,
        private lists: ListsRepo,
        private logger: Logger,
    ) {}

    /**
     * Return every list in a space the caller's workspace owns. The space is
     * resolved within the workspace first: a missing or cross-workspace id
     * yields `404 space.not_found` — never another workspace's data, and never
     * a misleading empty `200`.
     */
    async listBySpace(input: ListBySpaceInput): Promise<ListRecord[]> {
        const space = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!space) {
            this.logger.debug("list.list_by_space.space_not_found", {
                spaceId: input.spaceId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }

        return this.lists.findBySpace(input.spaceId, input.includeArchived);
    }

    /**
     * Every list in the caller's workspace, optionally narrowed to one space.
     * `workspaceId` is always the verified JWT's, never client input, so there
     * is no cross-tenant read path.
     *
     * When a `spaceId` filter is supplied it is resolved within the workspace
     * first: a missing or cross-workspace id yields `404 space.not_found` (same
     * contract as `listBySpace`) rather than a misleading empty `200`. With no
     * `spaceId`, all of the workspace's lists are returned.
     */
    async listAll(input: ListAllInput): Promise<ListRecord[]> {
        if (input.spaceId !== undefined) {
            const space = await this.spaces.findByIdInWorkspace(
                input.spaceId,
                input.workspaceId,
            );
            if (!space) {
                this.logger.debug("list.list_all.space_not_found", {
                    spaceId: input.spaceId,
                    workspaceId: input.workspaceId,
                });
                throw AppError.notFound(
                    "space.not_found",
                    `Space ${input.spaceId} does not exist`,
                );
            }
        }

        return this.lists.listByWorkspace(input.workspaceId, {
            spaceId: input.spaceId,
            includeArchived: input.includeArchived,
        });
    }

    /**
     * Read one list by id within the caller's workspace. A missing or
     * cross-workspace id is `404 list.not_found` (never another tenant's list,
     * no existence oracle). Archived lists ARE returned — `archived_at` is
     * soft-delete, and the detail / unarchive flows need to fetch them; the
     * list-only `archived_at IS NULL` filter does not apply to a direct read
     * (mirrors `TasksService.getById`). No transaction — a single-row read needs
     * no cross-table snapshot.
     */
    async getById(input: GetListInput): Promise<ListRecord> {
        const list = await this.lists.findRecordByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            this.logger.debug("list.get.not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        return list;
    }
}
