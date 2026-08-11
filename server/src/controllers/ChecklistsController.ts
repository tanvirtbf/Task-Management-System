import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { matchedData } from "express-validator";
import { ChecklistsService } from "../services/ChecklistsService";
import type { AuthRequest } from "../types";
import type {
    AddItemRequest,
    BulkAddItemsRequest,
    CreateChecklistRequest,
    UpdateChecklistRequest,
    UpdateItemRequest,
} from "../types/checklists";

/**
 * §15 Checklists HTTP layer. Translates the validated request into a service
 * call and the result into the wire shape. Identity + workspace scope always
 * come from `req.auth`, never the body. GET returns a bare `Checklist[]`
 * (items nested); creates 201; edits/toggle 200; deletes 204.
 */
export class ChecklistsController {
    constructor(
        private service: ChecklistsService,
        private logger: Logger,
    ) {}

    /** GET /api/v1/tasks/:id/checklists (🔐). */
    async listForTask(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const checklists = await this.service.listForTask({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
            });
            res.status(200).json(checklists);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/tasks/:id/checklists (🔐). 201. */
    async createChecklist(
        req: CreateChecklistRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { name } = matchedData(req, { locations: ["body"] }) as {
                name: string;
            };
            const checklist = await this.service.createChecklist({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                name,
            });
            this.logger.info("checklists.create.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                checklistId: checklist.id,
            });
            res.status(201).json(checklist);
        } catch (err) {
            next(err);
        }
    }

    /** PATCH /api/v1/checklists/:id (🔐). 200. */
    async updateChecklist(
        req: UpdateChecklistRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { name, position } = matchedData(req, {
                locations: ["body"],
            }) as { name?: string; position?: number };
            const checklist = await this.service.updateChecklist({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                name,
                position,
            });
            res.status(200).json(checklist);
        } catch (err) {
            next(err);
        }
    }

    /** DELETE /api/v1/checklists/:id (🔐). 204. */
    async removeChecklist(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await this.service.deleteChecklist({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/checklists/:id/items (🔐). 201. */
    async addItem(req: AddItemRequest, res: Response, next: NextFunction) {
        try {
            const { text, assignee_id, parent_item_id, position } = matchedData(
                req,
                { locations: ["body"] },
            ) as {
                text: string;
                assignee_id?: string | null;
                parent_item_id?: string | null;
                position?: number;
            };
            const item = await this.service.addItem({
                checklistId: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                text,
                assigneeId: assignee_id ?? null,
                parentItemId: parent_item_id ?? null,
                position,
            });
            res.status(201).json(item);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/checklists/:id/items/bulk (🔐). 201 — bare ChecklistItem[]. */
    async bulkAddItems(
        req: BulkAddItemsRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { texts } = matchedData(req, { locations: ["body"] }) as {
                texts: string[];
            };
            const items = await this.service.bulkAddItems({
                checklistId: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                texts,
            });
            res.status(201).json(items);
        } catch (err) {
            next(err);
        }
    }

    /** PATCH /api/v1/checklist-items/:id (🔐). 200. */
    async updateItem(req: UpdateItemRequest, res: Response, next: NextFunction) {
        try {
            const { text, assignee_id, position } = matchedData(req, {
                locations: ["body"],
            }) as {
                text?: string;
                assignee_id?: string | null;
                position?: number;
            };
            const item = await this.service.updateItem({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                text,
                assigneeId: assignee_id,
                position,
            });
            res.status(200).json(item);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/checklist-items/:id/toggle (🔐). 200. */
    async toggleItem(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const item = await this.service.toggleItem({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            res.status(200).json(item);
        } catch (err) {
            next(err);
        }
    }

    /** DELETE /api/v1/checklist-items/:id (🔐). 204. */
    async removeItem(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await this.service.deleteItem({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }
}
