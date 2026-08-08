import { AppError } from "../../src/errors";
import type { EffectiveGrantRow } from "../../src/repositories/UserRolesRepo";
import {
    assertCan,
    assertHolds,
    can,
    decide,
    denyMessage,
    entryFor,
    forbiddenFor,
    holds,
    isOwnResource,
    permissionErrorCode,
    RBAC_FORBIDDEN,
    type DenyReason,
    type PermissionContext,
} from "../../src/rbac/can";
import { PERMISSION_KEYS, type PermissionKey } from "../../src/rbac/catalog";
import type { ActorPermissions } from "../../src/rbac/types";
import { foldGrants } from "../../src/services/PolicyService";
import {
    assignRole,
    makeRbacSpace,
    makeRole,
    policyService,
    rbacRepos,
    rbacWorkspace,
    setGrants,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * P7 — `can()` / `assertCan()` and the 403 taxonomy.
 *
 * The centrepiece is THE MATRIX below: every way a grant can reach an actor,
 * crossed with every way a resource can relate to them. Each cell states the
 * exact outcome — allowed, or the reason it was not. If a future change to the
 * resolver or the decision shifts a single cell, this table says which one.
 */

const ME = "u-me";
const OTHER = "u-other";
const S = "sp-marketing";
const T = "sp-support";
const KEY: PermissionKey = "task.edit";

const grant = (
    grantScope: EffectiveGrantRow["grantScope"],
    assignment: "workspace" | typeof S | typeof T,
    permissionKey: PermissionKey = KEY,
): EffectiveGrantRow => ({
    permissionKey,
    grantScope,
    assignmentScopeType: assignment === "workspace" ? "workspace" : "space",
    assignmentScopeId: assignment === "workspace" ? null : assignment,
});

const actorFrom = (
    rows: readonly EffectiveGrantRow[],
    isOwner = false,
): ActorPermissions => ({
    kind: "user",
    userId: ME,
    workspaceId: "ws-1",
    isOwner,
    legacyRole: isOwner ? "owner" : "member",
    version: 1,
    perms: foldGrants(rows),
});

type Outcome = "allow" | DenyReason;

/** The six ways a resource can relate to the actor. */
const CONTEXTS: readonly [string, PermissionContext | undefined][] = [
    ["no context at all", undefined],
    ["in S, someone else's", { spaceId: S, createdBy: OTHER }],
    ["in T, someone else's", { spaceId: T, createdBy: OTHER }],
    ["in S, mine", { spaceId: S, createdBy: ME }],
    ["in T, mine", { spaceId: T, createdBy: ME }],
    ["no space, mine", { createdBy: ME }],
];

interface MatrixCase {
    what: string;
    rows: readonly EffectiveGrantRow[];
    isOwner?: boolean;
    /** One outcome per CONTEXTS entry, in order. */
    outcomes: readonly [Outcome, Outcome, Outcome, Outcome, Outcome, Outcome];
}

const MATRIX: readonly MatrixCase[] = [
    {
        what: "nothing granted",
        rows: [],
        outcomes: [
            "no_grant",
            "no_grant",
            "no_grant",
            "no_grant",
            "no_grant",
            "no_grant",
        ],
    },
    {
        what: "workspace assignment + 'all' grant",
        rows: [grant("all", "workspace")],
        outcomes: ["allow", "allow", "allow", "allow", "allow", "allow"],
    },
    {
        what: "workspace assignment + 'space' grant (reaches nothing)",
        rows: [grant("space", "workspace")],
        outcomes: [
            "no_grant",
            "no_grant",
            "no_grant",
            "no_grant",
            "no_grant",
            "no_grant",
        ],
    },
    {
        what: "workspace assignment + 'own' grant",
        rows: [grant("own", "workspace")],
        outcomes: [
            "not_own",
            "not_own",
            "not_own",
            "allow",
            "allow",
            "allow",
        ],
    },
    {
        what: "space(S) assignment + 'all' grant (downgraded to S)",
        rows: [grant("all", S)],
        outcomes: [
            "out_of_scope",
            "allow",
            "out_of_scope",
            "allow",
            "out_of_scope",
            "out_of_scope",
        ],
    },
    {
        what: "space(S) assignment + 'space' grant",
        rows: [grant("space", S)],
        outcomes: [
            "out_of_scope",
            "allow",
            "out_of_scope",
            "allow",
            "out_of_scope",
            "out_of_scope",
        ],
    },
    {
        what: "space(S) assignment + 'own' grant",
        rows: [grant("own", S)],
        outcomes: [
            "not_own",
            "not_own",
            "not_own",
            "allow",
            "out_of_scope",
            "out_of_scope",
        ],
    },
    {
        what: "union: workspace 'own' + space(S) 'all'",
        rows: [grant("own", "workspace"), grant("all", S)],
        outcomes: [
            "out_of_scope",
            "allow",
            "out_of_scope",
            "allow",
            "allow",
            "allow",
        ],
    },
    {
        what: "union: space(S) 'all' + space(T) 'space'",
        rows: [grant("all", S), grant("space", T)],
        outcomes: [
            "out_of_scope",
            "allow",
            "allow",
            "allow",
            "allow",
            "out_of_scope",
        ],
    },
    {
        what: "the OWNER, holding no grant rows at all",
        rows: [],
        isOwner: true,
        outcomes: ["allow", "allow", "allow", "allow", "allow", "allow"],
    },
];

describe("THE MATRIX — every grant shape x every resource relationship", () => {
    for (const c of MATRIX) {
        describe(c.what, () => {
            const actor = actorFrom(c.rows, c.isOwner);
            CONTEXTS.forEach(([label, ctx], i) => {
                const expected = c.outcomes[i];
                it(`${label} -> ${expected}`, () => {
                    const decision = decide(actor, KEY, ctx);
                    if (expected === "allow") {
                        expect(decision).toEqual({ allowed: true });
                        expect(can(actor, KEY, ctx)).toBe(true);
                    } else {
                        expect(decision).toEqual({
                            allowed: false,
                            reason: expected,
                        });
                        expect(can(actor, KEY, ctx)).toBe(false);
                    }
                });
            });
        });
    }

    it("covers all six relationships in every case", () => {
        for (const c of MATRIX) expect(c.outcomes).toHaveLength(CONTEXTS.length);
    });
});

describe("isOwnResource", () => {
    const actor = actorFrom([]);

    it("true when the actor created it", () => {
        expect(isOwnResource(actor, { createdBy: ME })).toBe(true);
    });

    it("true when the actor is one of the assignees", () => {
        expect(
            isOwnResource(actor, { assigneeIds: [OTHER, null, ME] }),
        ).toBe(true);
    });

    it("false for someone else's item", () => {
        expect(
            isOwnResource(actor, { createdBy: OTHER, assigneeIds: [OTHER] }),
        ).toBe(false);
    });

    it("ignores null/undefined assignee entries", () => {
        expect(
            isOwnResource(actor, { assigneeIds: [null, undefined] }),
        ).toBe(false);
    });

    it("an explicit isOwn wins over the derived fields", () => {
        expect(isOwnResource(actor, { createdBy: OTHER, isOwn: true })).toBe(
            true,
        );
        expect(isOwnResource(actor, { createdBy: ME, isOwn: false })).toBe(
            false,
        );
    });

    it("no actor / no context is never own", () => {
        expect(isOwnResource(null, { createdBy: ME })).toBe(false);
        expect(isOwnResource(actor, undefined)).toBe(false);
    });

    it("an unset createdBy does not match an unset actor id", () => {
        expect(isOwnResource(actor, { createdBy: null })).toBe(false);
    });
});

describe("entryFor + holds", () => {
    it("the owner holds every catalog permission", () => {
        const owner = actorFrom([], true);
        for (const key of PERMISSION_KEYS) {
            expect(entryFor(owner, key).all).toBe(true);
            expect(holds(owner, key)).toBe(true);
        }
    });

    it("a missing key resolves to the empty entry, not undefined", () => {
        const e = entryFor(actorFrom([]), KEY);
        expect(e).toEqual({
            all: false,
            spaceIds: new Set(),
            own: false,
            ownSpaceIds: new Set(),
        });
    });

    it("no actor resolves to the empty entry", () => {
        expect(entryFor(null, KEY).all).toBe(false);
        expect(holds(null, KEY)).toBe(false);
        expect(holds(undefined, KEY)).toBe(false);
    });

    it("holds() is true for ANY reach — that is the middleware's question", () => {
        expect(holds(actorFrom([grant("all", "workspace")]), KEY)).toBe(true);
        expect(holds(actorFrom([grant("own", "workspace")]), KEY)).toBe(true);
        expect(holds(actorFrom([grant("all", S)]), KEY)).toBe(true);
        expect(holds(actorFrom([grant("own", S)]), KEY)).toBe(true);
    });

    it("holds() is false when the grant reaches nowhere", () => {
        expect(holds(actorFrom([]), KEY)).toBe(false);
        expect(holds(actorFrom([grant("space", "workspace")]), KEY)).toBe(
            false,
        );
        // Granted a DIFFERENT permission.
        expect(
            holds(actorFrom([grant("all", "workspace", "task.view")]), KEY),
        ).toBe(false);
    });

    it("holds() true does NOT imply can() true — the two layers differ", () => {
        const actor = actorFrom([grant("all", S)]);
        expect(holds(actor, KEY)).toBe(true);
        expect(can(actor, KEY, { spaceId: T, createdBy: OTHER })).toBe(false);
    });
});

describe("the 403 taxonomy", () => {
    it("derives a per-domain code from the permission key", () => {
        expect(permissionErrorCode("task.edit")).toBe("task.forbidden");
        expect(permissionErrorCode("space.delete")).toBe("space.forbidden");
        expect(permissionErrorCode("list.delete")).toBe("list.forbidden");
        expect(permissionErrorCode("member.invite")).toBe("member.forbidden");
        expect(permissionErrorCode("workspace.settings")).toBe(
            "workspace.forbidden",
        );
        expect(permissionErrorCode("customfield.set_value")).toBe(
            "customfield.forbidden",
        );
        expect(permissionErrorCode("oncall.manage")).toBe("oncall.forbidden");
    });

    it("routes the RBAC-administration keys to rbac.forbidden", () => {
        expect(permissionErrorCode("role.manage")).toBe(RBAC_FORBIDDEN);
        expect(permissionErrorCode("role.assign")).toBe(RBAC_FORBIDDEN);
        expect(RBAC_FORBIDDEN).toBe("rbac.forbidden");
    });

    it("reuses the codes the dept-review services already return (P15 swap is invisible)", () => {
        expect(permissionErrorCode("review.perform")).toBe("review.forbidden");
        expect(permissionErrorCode("review.read")).toBe("review.forbidden");
        expect(permissionErrorCode("report.note")).toBe("report.forbidden");
        expect(permissionErrorCode("report.ack")).toBe("report.forbidden");
    });

    it("falls back to the generic code for an unnamespaced key", () => {
        expect(permissionErrorCode("")).toBe(RBAC_FORBIDDEN);
    });

    it("every catalog key yields a dotted code and a label-based message", () => {
        for (const key of PERMISSION_KEYS) {
            const code = permissionErrorCode(key);
            expect(code).toMatch(/^[a-z_]+\.forbidden$/);
            const message = denyMessage(key, "no_grant");
            // The message must name the capability, not echo the raw key.
            expect(message).not.toContain(key);
            expect(message.endsWith(".")).toBe(true);
            expect(message.length).toBeGreaterThan(20);
        }
    });

    it("words each reason as something the person can act on", () => {
        expect(denyMessage("task.edit", "no_grant")).toBe(
            "You don't have permission to edit tasks.",
        );
        expect(denyMessage("task.edit", "out_of_scope")).toBe(
            "You can only edit tasks inside the spaces you are assigned to.",
        );
        expect(denyMessage("task.edit", "not_own")).toBe(
            "You can only edit tasks for items you created or are assigned to.",
        );
    });

    it("builds a 403 AppError carrying the permission and the reason", () => {
        const err = forbiddenFor("space.delete", "out_of_scope");
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe("space.forbidden");
        expect(err.details).toEqual([
            { field: "permission", issue: "space.delete" },
            { field: "reason", issue: "out_of_scope" },
        ]);
    });

    it("leaks nothing about the resource — no ids in code, message or details", () => {
        const err = forbiddenFor("task.edit", "out_of_scope");
        const blob = JSON.stringify(err.details) + err.message + err.code;
        expect(blob).not.toContain(S);
        expect(blob).not.toContain(T);
        expect(blob).not.toContain(OTHER);
    });
});

describe("assertCan / assertHolds", () => {
    const reasonOf = (fn: () => void): { code: string; reason: string } => {
        try {
            fn();
        } catch (e) {
            const err = e as AppError;
            const reason =
                err.details?.find((d) => d.field === "reason")?.issue ?? "";
            return { code: err.code, reason };
        }
        throw new Error("expected a throw");
    };

    it("does not throw when allowed", () => {
        const actor = actorFrom([grant("all", "workspace")]);
        expect(() => assertCan(actor, KEY, { spaceId: T })).not.toThrow();
    });

    it("throws no_grant when the permission was never given", () => {
        expect(reasonOf(() => assertCan(actorFrom([]), KEY))).toEqual({
            code: "task.forbidden",
            reason: "no_grant",
        });
    });

    it("throws out_of_scope for the wrong space", () => {
        const actor = actorFrom([grant("all", S)]);
        expect(
            reasonOf(() => assertCan(actor, KEY, { spaceId: T })),
        ).toEqual({ code: "task.forbidden", reason: "out_of_scope" });
    });

    it("throws not_own for someone else's item", () => {
        const actor = actorFrom([grant("own", "workspace")]);
        expect(
            reasonOf(() =>
                assertCan(actor, KEY, { spaceId: S, createdBy: OTHER }),
            ),
        ).toEqual({ code: "task.forbidden", reason: "not_own" });
    });

    it("throws no_grant for a null actor (fail-closed)", () => {
        expect(reasonOf(() => assertCan(null, KEY))).toEqual({
            code: "task.forbidden",
            reason: "no_grant",
        });
    });

    it("assertHolds passes a space-limited holder through to the service layer", () => {
        const actor = actorFrom([grant("all", S)]);
        expect(() => assertHolds(actor, KEY)).not.toThrow();
        // ...which then denies the specific object.
        expect(() => assertCan(actor, KEY, { spaceId: T })).toThrow(AppError);
    });

    it("assertHolds throws no_grant for a non-holder", () => {
        expect(reasonOf(() => assertHolds(actorFrom([]), KEY))).toEqual({
            code: "task.forbidden",
            reason: "no_grant",
        });
    });

    it("rejects a key that is not in the catalog at COMPILE time", () => {
        // @ts-expect-error — if this stops erroring, `PermissionKey` has
        // widened back to `string` and every enforcement call site has lost
        // its typo protection.
        expect(can(null, "task.editt")).toBe(false);
    });
});

describe("against the database — the whole chain", () => {
    const policy = policyService;

    it("a space-scoped role reaches its own space and nowhere else", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const marketing = await makeRbacSpace(ws.id, admin.id, "Marketing");
        const support = await makeRbacSpace(ws.id, admin.id, "Support");

        const u = await userWithPermissions(ws, ["task.edit"], {
            spaceId: marketing,
        });
        const actor = await policy().resolveActor(u.id, ws.id);

        expect(can(actor, "task.edit", { spaceId: marketing })).toBe(true);
        expect(can(actor, "task.edit", { spaceId: support })).toBe(false);
        expect(decide(actor, "task.edit", { spaceId: support })).toEqual({
            allowed: false,
            reason: "out_of_scope",
        });
        // Holds it somewhere, so the route middleware lets them in.
        expect(holds(actor, "task.edit")).toBe(true);
    });

    it("an 'own'-scoped role follows the person, not the space", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const space = await makeRbacSpace(ws.id, admin.id);

        const u = await userWithPermissions(ws, [["task.edit", "own"]]);
        const actor = await policy().resolveActor(u.id, ws.id);

        expect(
            can(actor, "task.edit", { spaceId: space, createdBy: u.id }),
        ).toBe(true);
        expect(
            can(actor, "task.edit", { spaceId: space, assigneeIds: [u.id] }),
        ).toBe(true);
        expect(
            can(actor, "task.edit", { spaceId: space, createdBy: admin.id }),
        ).toBe(false);
    });

    it("the seeded system roles still reproduce today's behaviour through can()", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const space = await makeRbacSpace(ws.id, admin.id);
        const ctx = { spaceId: space, createdBy: "someone-else" };
        const svc = policy();

        const owner = await userWithSystemRole(ws, "owner");
        const member = await userWithSystemRole(ws, "member");
        const guest = await userWithSystemRole(ws, "guest");

        const a = {
            owner: await svc.resolveActor(owner.id, ws.id),
            admin: await svc.resolveActor(admin.id, ws.id),
            member: await svc.resolveActor(member.id, ws.id),
            guest: await svc.resolveActor(guest.id, ws.id),
        };

        // Every INTERNAL role could edit/delete any task before RBAC — still
        // true. F28 (D12.1) removed the guest from this list: it is an external
        // persona and the seeded role no longer grants task writes.
        for (const actor of [a.owner, a.admin, a.member]) {
            expect(can(actor, "task.edit", ctx)).toBe(true);
            expect(can(actor, "task.delete", ctx)).toBe(true);
            expect(can(actor, "comment.create", ctx)).toBe(true);
        }
        // A guest reads and comments; it does not write.
        expect(can(a.guest, "task.view", ctx)).toBe(true);
        expect(can(a.guest, "comment.create", ctx)).toBe(true);
        expect(can(a.guest, "task.edit", ctx)).toBe(false);
        expect(can(a.guest, "task.delete", ctx)).toBe(false);
        // ...and the three real distinctions of today survive.
        expect(can(a.guest, "attachment.upload", ctx)).toBe(false);
        expect(can(a.member, "attachment.upload", ctx)).toBe(true);
        expect(can(a.member, "member.invite")).toBe(false);
        expect(can(a.admin, "member.invite")).toBe(true);
        expect(can(a.admin, "space.delete", ctx)).toBe(false);
        expect(can(a.owner, "space.delete", ctx)).toBe(true);
    });

    it("a revoked permission stops passing can() on the next call", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["workspace.settings"]);
        const svc = policy();

        expect(
            can(await svc.resolveActor(u.id, ws.id), "workspace.settings"),
        ).toBe(true);

        await setGrants(u.roleId, []);
        await rbacRepos().roles.bumpPermissionsVersion(ws.id);

        const actor = await svc.resolveActor(u.id, ws.id);
        expect(can(actor, "workspace.settings")).toBe(false);
        expect(() => assertCan(actor, "workspace.settings")).toThrow(
            /don't have permission/,
        );
    });

    it("two space-scoped roles union into both spaces", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const marketing = await makeRbacSpace(ws.id, admin.id, "Marketing");
        const support = await makeRbacSpace(ws.id, admin.id, "Support");

        const u = await userWithPermissions(ws, ["review.perform"], {
            spaceId: marketing,
        });
        const second = await makeRole(ws.id, {
            grants: [["review.perform", "space"]],
        });
        await assignRole({
            workspaceId: ws.id,
            userId: u.id,
            roleId: second,
            spaceId: support,
        });

        const actor = await policy().resolveActor(u.id, ws.id);
        expect(can(actor, "review.perform", { spaceId: marketing })).toBe(true);
        expect(can(actor, "review.perform", { spaceId: support })).toBe(true);
        expect(can(actor, "review.perform")).toBe(false);
    });

    it("the PolicyService methods are the same decision as the pure functions", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const space = await makeRbacSpace(ws.id, admin.id);
        const u = await userWithPermissions(ws, ["task.edit"], {
            spaceId: space,
        });
        const svc = policy();
        const actor = await svc.resolveActor(u.id, ws.id);

        expect(svc.can(actor, "task.edit", { spaceId: space })).toBe(
            can(actor, "task.edit", { spaceId: space }),
        );
        expect(svc.holds(actor, "task.edit")).toBe(holds(actor, "task.edit"));
        expect(svc.decide(actor, "task.edit")).toEqual(
            decide(actor, "task.edit"),
        );
        expect(svc.entryFor(actor, "task.edit")).toEqual(
            entryFor(actor, "task.edit"),
        );
        expect(() => svc.assertCan(actor, "task.edit")).toThrow(AppError);
        expect(() => svc.assertHolds(actor, "task.edit")).not.toThrow();
    });
});
