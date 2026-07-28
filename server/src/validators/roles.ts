import { body, param } from "express-validator";
import { PERMISSION_SCOPES } from "../rbac/catalog";

/** §34 validators. Semantic checks (unknown key, unsupported scope, escalation,
 *  lockout) live in `RolesAdminService` — these only shape the input. */

const HEX = /^#[0-9A-Fa-f]{6}$/;

const permissionsArray = body("permissions")
    .optional()
    .isArray({ max: 200 })
    .withMessage("permissions must be an array");

const permissionEntries = [
    body("permissions.*.key")
        .isString()
        .trim()
        .notEmpty()
        .withMessage("permission key is required"),
    body("permissions.*.scope")
        .isString()
        .isIn([...PERMISSION_SCOPES])
        .withMessage(`scope must be one of: ${PERMISSION_SCOPES.join(", ")}`),
];

export const createRoleValidator = [
    body("name")
        .isString()
        .trim()
        .isLength({ min: 1, max: 80 })
        .withMessage("name must be 1-80 characters"),
    body("description")
        .optional({ nullable: true })
        .isString()
        .isLength({ max: 300 }),
    body("color").optional().matches(HEX).withMessage("color must be #RRGGBB"),
    permissionsArray,
    ...permissionEntries,
];

export const updateRoleValidator = [
    param("id").isString().trim().notEmpty(),
    body("name").optional().isString().trim().isLength({ min: 1, max: 80 }),
    body("description")
        .optional({ nullable: true })
        .isString()
        .isLength({ max: 300 }),
    body("color").optional().matches(HEX).withMessage("color must be #RRGGBB"),
];

export const roleIdValidator = [param("id").isString().trim().notEmpty()];

export const setPermissionsValidator = [
    param("id").isString().trim().notEmpty(),
    body("permissions").isArray({ max: 200 }).withMessage("permissions is required"),
    ...permissionEntries,
];

export const assignRoleValidator = [
    param("id").isString().trim().notEmpty(),
    body("role_id").isString().trim().notEmpty().withMessage("role_id is required"),
    body("space_id").optional({ nullable: true }).isString().trim().notEmpty(),
];

export const revokeRoleValidator = [
    param("id").isString().trim().notEmpty(),
    param("assignmentId").isString().trim().notEmpty(),
];
