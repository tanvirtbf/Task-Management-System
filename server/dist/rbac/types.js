"use strict";
// =============================================================================
// RBAC DOMAIN TYPES — the resolved-actor model.
//   Plan: RBAC_DYNAMIC_PLAN.md Part 2.3
//
// These live in `rbac/` rather than inside a service on purpose: the decision
// function `can()` (P7), the `requirePermission` middleware (P11) and the
// repository predicates (P8/P16+) must all be able to reason about an actor
// WITHOUT constructing a `PolicyService`. Only the resolution (DB read +
// cache) needs the service; the decision is pure.
//
// `PolicyService` re-exports everything here, so the P6 import path still
// works.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_PERMISSION = void 0;
const EMPTY_SET = new Set();
/** An entry that grants nothing — the shape `can()` sees for an absent key. */
exports.NO_PERMISSION = {
    all: false,
    spaceIds: EMPTY_SET,
    own: false,
    ownSpaceIds: EMPTY_SET,
};
