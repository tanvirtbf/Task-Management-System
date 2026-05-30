import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { SpacesRepo, type SpaceRecord } from "../repositories/SpacesRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";

export interface ListSpacesInput {
    workspaceId: string;
    includeArchived: boolean;
}

export interface GetSpaceInput {
    spaceId: string;
    workspaceId: string;
}

export interface CreateSpaceInput {
    workspaceId: string;
    actorId: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    isPrivate: boolean;
    position: number;
}

/**
 * §5 Spaces business logic. The read paths are single workspace-scoped reads;
 * `create` owns the transaction that pairs the space insert with its
 * `workspace_activity` audit row.
 */
export class SpacesService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private spaces: SpacesRepo,
        private activity: WorkspaceActivityRepo,
        private logger: Logger,
    ) {}

    /**
     * List the spaces in a workspace. The `workspaceId` always comes from the
     * caller's verified JWT (`req.auth.workspaceId`) — never from client input
     * — so there is no cross-tenant read path.
     */
    async listSpaces(input: ListSpacesInput): Promise<SpaceRecord[]> {
        return this.spaces.listByWorkspace(input.workspaceId, {
            includeArchived: input.includeArchived,
        });
    }

    /**
     * Read a single space within the caller's workspace. A missing or
     * cross-workspace id both resolve to `404 space.not_found` — the repo
     * scopes by `workspace_id`, so there is no cross-tenant existence oracle.
     * An archived space still exists and is returned (200), not 404.
     */
    async getSpace(input: GetSpaceInput): Promise<SpaceRecord> {
        const space = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!space) {
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }
        return space;
    }

    /**
     * Create a space and record the `created` activity in the same transaction
     * (all-or-nothing). The workspace and actor come from the caller's verified
     * token (`req.auth`), never the body, so the space always lands in the
     * caller's own workspace. `spaces` has no unique constraint, so there is no
     * duplicate-name conflict — two spaces may share a name.
     *
     * The just-inserted row is re-read inside the transaction so the response
     * carries the authoritative DB `created_at`, identical to a later GET.
     */
    async create(input: CreateSpaceInput): Promise<SpaceRecord> {
        return this.db.transaction(async (tx) => {
            const id = await this.spaces.insert(
                {
                    workspaceId: input.workspaceId,
                    name: input.name,
                    description: input.description,
                    icon: input.icon,
                    color: input.color,
                    isPrivate: input.isPrivate,
                    position: input.position,
                    createdBy: input.actorId,
                },
                tx,
            );
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "space",
                    entityId: id,
                    action: "created",
                    context: { name: input.name },
                },
                tx,
            );
            const space = await this.spaces.findByIdInWorkspace(
                id,
                input.workspaceId,
                tx,
            );
            if (!space) {
                // Unreachable: the row was just inserted in this transaction.
                // The guard only satisfies the `SpaceRecord | null` return type.
                throw AppError.internal();
            }
            return space;
        });
    }
}
