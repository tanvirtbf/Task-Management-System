"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPolicy = exports.getPolicy = void 0;
const logger_1 = __importDefault(require("../config/logger"));
const client_1 = require("../db/client");
const ListsRepo_1 = require("../repositories/ListsRepo");
const UserRolesRepo_1 = require("../repositories/UserRolesRepo");
const PolicyService_1 = require("../services/PolicyService");
/**
 * THE process-wide `PolicyService`.
 *
 * There must be exactly one: its actor cache is keyed by `(workspace, user)`
 * plus `permissions_version`, and that cache is what makes an authorization
 * check cost a single indexed query instead of a join on every request. A
 * per-router instance would each hold their own cold cache.
 *
 * Lazily constructed so importing a router never runs `getDb()` before
 * `server.ts` has called `initDb()`.
 */
let instance = null;
const getPolicy = () => {
    if (!instance) {
        const db = (0, client_1.getDb)();
        instance = new PolicyService_1.PolicyService(new UserRolesRepo_1.UserRolesRepo(db), new ListsRepo_1.ListsRepo(db), logger_1.default);
    }
    return instance;
};
exports.getPolicy = getPolicy;
/** Drop the singleton (tests that swap the database handle). */
const resetPolicy = () => {
    instance = null;
};
exports.resetPolicy = resetPolicy;
