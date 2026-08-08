"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChecklistsController = void 0;
const express_validator_1 = require("express-validator");
/**
 * §15 Checklists HTTP layer. Translates the validated request into a service
 * call and the result into the wire shape. Identity + workspace scope always
 * come from `req.auth`, never the body. GET returns a bare `Checklist[]`
 * (items nested); creates 201; edits/toggle 200; deletes 204.
 */
class ChecklistsController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /** GET /api/v1/tasks/:id/checklists (🔐). */
    async listForTask(req, res, next) {
        try {
            const checklists = await this.service.listForTask({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
            });
            res.status(200).json(checklists);
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/tasks/:id/checklists (🔐). 201. */
    async createChecklist(req, res, next) {
        try {
            const { name } = (0, express_validator_1.matchedData)(req, { locations: ["body"] });
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
        }
        catch (err) {
            next(err);
        }
    }
    /** PATCH /api/v1/checklists/:id (🔐). 200. */
    async updateChecklist(req, res, next) {
        try {
            const { name, position } = (0, express_validator_1.matchedData)(req, {
                locations: ["body"],
            });
            const checklist = await this.service.updateChecklist({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                name,
                position,
            });
            res.status(200).json(checklist);
        }
        catch (err) {
            next(err);
        }
    }
    /** DELETE /api/v1/checklists/:id (🔐). 204. */
    async removeChecklist(req, res, next) {
        try {
            await this.service.deleteChecklist({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/checklists/:id/items (🔐). 201. */
    async addItem(req, res, next) {
        try {
            const { text, assignee_id, parent_item_id, position } = (0, express_validator_1.matchedData)(req, { locations: ["body"] });
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
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/checklists/:id/items/bulk (🔐). 201 — bare ChecklistItem[]. */
    async bulkAddItems(req, res, next) {
        try {
            const { texts } = (0, express_validator_1.matchedData)(req, { locations: ["body"] });
            const items = await this.service.bulkAddItems({
                checklistId: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                texts,
            });
            res.status(201).json(items);
        }
        catch (err) {
            next(err);
        }
    }
    /** PATCH /api/v1/checklist-items/:id (🔐). 200. */
    async updateItem(req, res, next) {
        try {
            const { text, assignee_id, position } = (0, express_validator_1.matchedData)(req, {
                locations: ["body"],
            });
            const item = await this.service.updateItem({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                text,
                assigneeId: assignee_id,
                position,
            });
            res.status(200).json(item);
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/checklist-items/:id/toggle (🔐). 200. */
    async toggleItem(req, res, next) {
        try {
            const item = await this.service.toggleItem({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            res.status(200).json(item);
        }
        catch (err) {
            next(err);
        }
    }
    /** DELETE /api/v1/checklist-items/:id (🔐). 204. */
    async removeItem(req, res, next) {
        try {
            await this.service.deleteItem({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
}
exports.ChecklistsController = ChecklistsController;
