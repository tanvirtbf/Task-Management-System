"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeRoleValidator = exports.assignRoleValidator = exports.setPermissionsValidator = exports.roleIdValidator = exports.updateRoleValidator = exports.createRoleValidator = void 0;
const express_validator_1 = require("express-validator");
const catalog_1 = require("../rbac/catalog");
/** §34 validators. Semantic checks (unknown key, unsupported scope, escalation,
 *  lockout) live in `RolesAdminService` — these only shape the input. */
const HEX = /^#[0-9A-Fa-f]{6}$/;
const permissionsArray = (0, express_validator_1.body)("permissions")
    .optional()
    .isArray({ max: 200 })
    .withMessage("permissions must be an array");
const permissionEntries = [
    (0, express_validator_1.body)("permissions.*.key")
        .isString()
        .trim()
        .notEmpty()
        .withMessage("permission key is required"),
    (0, express_validator_1.body)("permissions.*.scope")
        .isString()
        .isIn([...catalog_1.PERMISSION_SCOPES])
        .withMessage(`scope must be one of: ${catalog_1.PERMISSION_SCOPES.join(", ")}`),
];
exports.createRoleValidator = [
    (0, express_validator_1.body)("name")
        .isString()
        .trim()
        .isLength({ min: 1, max: 80 })
        .withMessage("name must be 1-80 characters"),
    (0, express_validator_1.body)("description")
        .optional({ nullable: true })
        .isString()
        .isLength({ max: 300 }),
    (0, express_validator_1.body)("color").optional().matches(HEX).withMessage("color must be #RRGGBB"),
    permissionsArray,
    ...permissionEntries,
];
exports.updateRoleValidator = [
    (0, express_validator_1.param)("id").isString().trim().notEmpty(),
    (0, express_validator_1.body)("name").optional().isString().trim().isLength({ min: 1, max: 80 }),
    (0, express_validator_1.body)("description")
        .optional({ nullable: true })
        .isString()
        .isLength({ max: 300 }),
    (0, express_validator_1.body)("color").optional().matches(HEX).withMessage("color must be #RRGGBB"),
];
exports.roleIdValidator = [(0, express_validator_1.param)("id").isString().trim().notEmpty()];
exports.setPermissionsValidator = [
    (0, express_validator_1.param)("id").isString().trim().notEmpty(),
    (0, express_validator_1.body)("permissions").isArray({ max: 200 }).withMessage("permissions is required"),
    ...permissionEntries,
];
exports.assignRoleValidator = [
    (0, express_validator_1.param)("id").isString().trim().notEmpty(),
    (0, express_validator_1.body)("role_id").isString().trim().notEmpty().withMessage("role_id is required"),
    (0, express_validator_1.body)("space_id").optional({ nullable: true }).isString().trim().notEmpty(),
];
exports.revokeRoleValidator = [
    (0, express_validator_1.param)("id").isString().trim().notEmpty(),
    (0, express_validator_1.param)("assignmentId").isString().trim().notEmpty(),
];
