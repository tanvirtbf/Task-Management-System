"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomFieldsController = void 0;
const toWireCustomField = (h) => {
    const { field, options } = h;
    const wire = {
        id: field.id,
        scope_type: field.scopeType,
        scope_id: field.scopeId,
        name: field.name,
        type: field.type,
        config: field.config ?? {},
        is_required: field.isRequired,
        default_value: field.defaultValue ?? null,
        position: field.position,
    };
    if (field.type === "dropdown") {
        wire.options = options.map((o) => ({
            id: o.id,
            label: o.label,
            color: o.color,
            position: o.position,
        }));
    }
    return wire;
};
/**
 * §17 Custom Fields HTTP layer. Definition CRUD (#1–#5) returns the wire
 * `CustomField`; the value endpoints (#6/#7) act on a task (PUT returns the full
 * updated Task, DELETE returns 204).
 */
class CustomFieldsController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    async listAll(req, res, next) {
        try {
            const { workspaceId } = req.auth;
            const scopeType = req.query.scope_type;
            const scopeId = typeof req.query.scope_id === "string"
                ? req.query.scope_id
                : undefined;
            const fields = await this.service.listAll({
                workspaceId,
                ...(scopeType !== undefined ? { scopeType } : {}),
                ...(scopeId !== undefined ? { scopeId } : {}),
            });
            res.status(200).json(fields.map(toWireCustomField));
        }
        catch (err) {
            next(err);
        }
    }
    async listForList(req, res, next) {
        try {
            const { workspaceId } = req.auth;
            const listId = req.params.listId;
            const fields = await this.service.listForList({
                workspaceId,
                listId,
            });
            res.status(200).json(fields.map(toWireCustomField));
        }
        catch (err) {
            next(err);
        }
    }
    async create(req, res, next) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const body = req.body;
            const field = await this.service.create({
                workspaceId,
                actorId,
                scopeType: body.scope_type,
                scopeId: body.scope_id ?? null,
                name: body.name,
                type: body.type,
                config: body.config ?? {},
                isRequired: body.is_required ?? false,
                defaultValue: body.default_value ?? null,
                position: body.position ?? 0,
                options: body.options ?? [],
            });
            this.logger.info("custom_field.created", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                customFieldId: field.field.id,
            });
            res.status(201).json(toWireCustomField(field));
        }
        catch (err) {
            next(err);
        }
    }
    async update(req, res, next) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const fieldId = req.params.id;
            const body = req.body;
            const fields = {};
            if (body.name !== undefined)
                fields.name = body.name;
            if (body.config !== undefined)
                fields.config = body.config;
            if (body.is_required !== undefined)
                fields.isRequired = body.is_required;
            if (body.position !== undefined)
                fields.position = body.position;
            const field = await this.service.update({
                fieldId,
                workspaceId,
                actorId,
                fields,
            });
            this.logger.info("custom_field.updated", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                customFieldId: fieldId,
                fields: Object.keys(fields),
            });
            res.status(200).json(toWireCustomField(field));
        }
        catch (err) {
            next(err);
        }
    }
    async remove(req, res, next) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const fieldId = req.params.id;
            await this.service.remove({ fieldId, workspaceId, actorId });
            this.logger.info("custom_field.deleted", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                customFieldId: fieldId,
            });
            res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    }
    async setValue(req, res, next) {
        try {
            const { sub: actorId, workspaceId, role } = req.auth;
            const taskId = req.params.id;
            const fieldId = req.params.fieldId;
            const task = await this.service.setValue({
                taskId,
                fieldId,
                workspaceId,
                actorId,
                role,
                value: req.body,
            });
            this.logger.info("custom_field.value.set", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                taskId,
                fieldId,
            });
            res.status(200).json(task);
        }
        catch (err) {
            next(err);
        }
    }
    async clearValue(req, res, next) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const taskId = req.params.id;
            const fieldId = req.params.fieldId;
            await this.service.clearValue({
                taskId,
                fieldId,
                workspaceId,
                actorId,
            });
            this.logger.info("custom_field.value.cleared", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                taskId,
                fieldId,
            });
            res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    }
}
exports.CustomFieldsController = CustomFieldsController;
