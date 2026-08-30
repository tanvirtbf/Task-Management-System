import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";
import { ReviewsRepo } from "../../src/repositories/ReviewsRepo";
import { assertCan, can, holds } from "../../src/rbac/can";
import { PERMISSION_KEYS, type PermissionKey } from "../../src/rbac/catalog";
import {
    elevate,
    elevateToSpaces,
    elevationReasons,
    isPublic,
    isSystem,
    publicFormPrincipal,
    SYSTEM_USER_ID,
    systemActor,
    systemPrincipal,
} from "../../src/rbac/principals";
import {
    ALL_VISIBLE,
    scopePredicate,
    type VisibilityScope,
} from "../../src/rbac/scope";
import { dhakaToday } from "../../src/utils/dhakaTime";
import { makeTask } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    policyService,
    rbacRepos,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * P9 — the callers that have no session, and the deliberate bypasses.
 *
 * The headline test is the last block: it demonstrates the landmine (L1) that
 * would silently corrupt every department report, and pins the numbers so that
 * P16-P19 cannot reintroduce it.
 */

const anySpace = "sp-somewhere";

describe("the system principal (background jobs, L5)", () => {
    it("is a system actor, NOT a fake owner", () => {
        const actor = systemActor("ws-1");
        expect(actor.kind).toBe("system");
        expect(actor.userId).toBe(SYSTEM_USER_ID);
        expect(actor.isOwner).toBe(false);
        expect(actor.perms.size).toBe(0);
        expect(isSystem(actor)).toBe(true);
        expect(isPublic(actor)).toBe(false);
    });

    it("holds every permission in the catalog", () => {
        const actor = systemActor("ws-1");
        for (const key of PERMISSION_KEYS) {
            expect(holds(actor, key)).toBe(true);
            expect(can(actor, key)).toBe(true);
            expect(
                can(actor, key, {
                    spaceId: anySpace,
                    createdBy: "someone-else",
                }),
            ).toBe(true);
        }
    });

    it("never throws from a guard", () => {
        const actor = systemActor("ws-1");
        expect(() => assertCan(actor, "space.delete")).not.toThrow();
        expect(() =>
            assertCan(actor, "report.note", { spaceId: anySpace }),
        ).not.toThrow();
    });

    it("sees the whole workspace, adding no SQL", () => {
        const p = systemPrincipal("ws-1");
        expect(p.scope).toEqual(ALL_VISIBLE);
        expect(
            scopePredicate(p.scope, { listCol: tasks.primaryListId }),
        ).toBeUndefined();
    });

    it("a normal user is not a system actor", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithSystemRole(ws, "owner");
        const actor = await policyService().resolveActor(u.id, ws.id);
        expect(actor?.kind).toBe("user");
        expect(isSystem(actor)).toBe(false);
        expect(actor?.isOwner).toBe(true); // the owner floor, not the job floor
    });
});

describe("the public-form principal (anonymous submissions, L4)", () => {
    const p = publicFormPrincipal({
        workspaceId: "ws-1",
        spaceId: "sp-intake",
        listId: "l-intake",
        attributedTo: "u-form-owner",
    });

    it("keeps the form creator as the attribution identity", () => {
        expect(p.actor.kind).toBe("public");
        expect(p.actor.userId).toBe("u-form-owner");
        expect(p.actor.legacyRole).toBe("member");
        expect(p.actor.isOwner).toBe(false);
        expect(isPublic(p.actor)).toBe(true);
        expect(isSystem(p.actor)).toBe(false);
    });

    it("holds EXACTLY the two permissions a submission needs", () => {
        const held = PERMISSION_KEYS.filter((k) => holds(p.actor, k));
        expect([...held].sort()).toEqual([
            "customfield.set_value",
            "task.create",
        ]);
    });

    it("can create only inside the form's own space", () => {
        expect(can(p.actor, "task.create", { spaceId: "sp-intake" })).toBe(
            true,
        );
        expect(can(p.actor, "task.create", { spaceId: "sp-other" })).toBe(
            false,
        );
        expect(can(p.actor, "task.create")).toBe(false);
    });

    it("cannot read, edit, delete or administer anything", () => {
        const ctx = { spaceId: "sp-intake" };
        for (const key of [
            "task.view",
            "task.edit",
            "task.delete",
            "space.view",
            "comment.create",
            "attachment.upload",
            "form.manage",
            "form.view_submissions",
            "member.invite",
            "role.manage",
        ] as PermissionKey[]) {
            expect(can(p.actor, key, ctx)).toBe(false);
        }
    });

    it("sees the form's list and nothing else", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const intake = await makeRbacSpace(ws.id, owner.id, "Intake");
        const other = await makeRbacSpace(ws.id, owner.id, "Other");
        const intakeList = await makeRbacList(ws.id, intake, owner.id);
        const otherList = await makeRbacList(ws.id, other, owner.id);
        const submitted = await makeTask({
            workspaceId: ws.id,
            listId: intakeList,
        });
        const secret = await makeTask({
            workspaceId: ws.id,
            listId: otherList,
        });

        const principal = publicFormPrincipal({
            workspaceId: ws.id,
            spaceId: intake,
            listId: intakeList,
            attributedTo: owner.id,
        });
        const rows = await getDb()
            .select({ id: tasks.id })
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, ws.id),
                    scopePredicate(principal.scope, {
                        listCol: tasks.primaryListId,
                    }),
                ),
            );
        expect(rows.map((r) => r.id)).toEqual([submitted.id]);
        expect(rows.map((r) => r.id)).not.toContain(secret.id);
    });
});

describe("elevation — every bypass is named", () => {
    it("pins the closed set of reasons", () => {
        expect([...elevationReasons()].sort()).toEqual([
            "dept_review_stats",
            "job",
            "public_form",
            "weekly_report",
        ]);
    });

    it("elevate() is deliberately unrestricted", () => {
        expect(elevate("job")).toEqual(ALL_VISIBLE);
        expect(
            scopePredicate(elevate("public_form"), {
                listCol: tasks.primaryListId,
            }),
        ).toBeUndefined();
    });

    it("elevateToSpaces() stops at the edge of the named spaces", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mktA = await makeRbacList(ws.id, marketing, owner.id);
        const mktB = await makeRbacList(ws.id, marketing, owner.id);
        const sup = await makeRbacList(ws.id, support, owner.id);

        const scope = await elevateToSpaces("dept_review_stats", {
            spaceIds: [marketing],
            workspaceId: ws.id,
            source: rbacRepos().lists,
        });
        expect(scope).toEqual({
            kind: "scoped",
            spaceIds: [marketing],
            listIds: [mktA, mktB].sort(),
        });
        const reached = scope.kind === "scoped" ? [...scope.listIds] : [];
        expect(reached).not.toContain(sup);
    });

    it("elevating to NO spaces grants nothing (never everything)", async () => {
        const scope = await elevateToSpaces("weekly_report", {
            spaceIds: [],
            workspaceId: "ws-1",
            source: rbacRepos().lists,
        });
        expect(scope).toEqual({ kind: "scoped", spaceIds: [], listIds: [] });
        const rendered = getDb()
            .select({ id: tasks.id })
            .from(tasks)
            .where(scopePredicate(scope, { listCol: tasks.primaryListId }))
            .toSQL();
        expect(rendered.sql).toContain("1 = 0");
    });

    it("PolicyService.elevateToSpaces delegates to the same thing", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const space = await makeRbacSpace(ws.id, owner.id);
        const list = await makeRbacList(ws.id, space, owner.id);

        expect(
            await policyService().elevateToSpaces(
                "dept_review_stats",
                [space],
                ws.id,
            ),
        ).toEqual({ kind: "scoped", spaceIds: [space], listIds: [list] });
    });
});

describe("PolicyService.principalFor — the signed-in caller", () => {
    it("returns actor + scope in one object", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const list = await makeRbacList(ws.id, marketing, owner.id);
        const u = await userWithPermissions(ws, [["space.view", "space"]], {
            spaceId: marketing,
        });

        const p = await policyService().principalFor(u.id, ws.id);
        expect(p?.actor.userId).toBe(u.id);
        expect(p?.actor.kind).toBe("user");
        expect(p?.scope).toEqual({
            kind: "scoped",
            spaceIds: [marketing],
            listIds: [list],
        });
    });

    it("is null for a user outside the workspace", async () => {
        const a = await rbacWorkspace();
        const b = await rbacWorkspace();
        const u = await userWithSystemRole(a, "admin");
        expect(await policyService().principalFor(u.id, b.id)).toBeNull();
    });
});

/**
 * LANDMINE L1 — the reason this phase exists.
 *
 * `/dept` queues and the weekly report count EVERY task in a department. They
 * are already gated at the boundary ("head of this space, or an admin"). If
 * P16-P19 were to filter them by the READER's personal visibility instead, the
 * numbers would quietly become a subset — a report that says "3 open" when the
 * department has 8, with nothing anywhere reporting an error.
 */
describe("L1 — department numbers must not follow the reader's reach", () => {
    const countUnder = async (
        workspaceId: string,
        departmentLists: string[],
        scope: VisibilityScope,
    ): Promise<number> => {
        const rows = await getDb()
            .select({ id: tasks.id })
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    // What the department query already does today...
                    inArray(tasks.primaryListId, departmentLists),
                    // ...and what P19 would add on top.
                    scopePredicate(scope, { listCol: tasks.primaryListId }),
                ),
            );
        return rows.length;
    };

    it("an elevated scope reproduces the real number; a personal one does not", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mktA = await makeRbacList(ws.id, marketing, owner.id);
        const mktB = await makeRbacList(ws.id, marketing, owner.id);
        const supList = await makeRbacList(ws.id, support, owner.id);

        await makeTask({ workspaceId: ws.id, listId: mktA });
        await makeTask({ workspaceId: ws.id, listId: mktA });
        await makeTask({ workspaceId: ws.id, listId: mktB });
        await makeTask({ workspaceId: ws.id, listId: supList });

        // GROUND TRUTH — the number the dept-review feature reports today.
        const summary = await new ReviewsRepo(getDb()).summaryTotals(
            marketing,
            dhakaToday(),
        );
        expect(summary.open).toBe(3);

        // An admin who may read Marketing's report but whose OWN visibility was
        // tightened to Support only.
        const admin = await userWithPermissions(
            ws,
            [["space.view", "space"], "report.view", "review.read"],
            { spaceId: support },
        );
        const svc = policyService();
        const actor = await svc.resolveActor(admin.id, ws.id);
        const personal = await svc.visibilityFor(actor);
        expect(personal).toEqual({
            kind: "scoped",
            spaceIds: [support],
            listIds: [supList],
        });

        // THE BUG, if the reader's scope were used: zero.
        expect(await countUnder(ws.id, [mktA, mktB], personal)).toBe(0);

        // THE FIX: elevation for a boundary-authorized aggregate.
        const elevated = await svc.elevateToSpaces(
            "dept_review_stats",
            [marketing],
            ws.id,
        );
        expect(await countUnder(ws.id, [mktA, mktB], elevated)).toBe(
            summary.open,
        );
    });

    it("the weekly job sees every department, unfiltered", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mkt = await makeRbacList(ws.id, marketing, owner.id);
        const sup = await makeRbacList(ws.id, support, owner.id);
        await makeTask({ workspaceId: ws.id, listId: mkt });
        await makeTask({ workspaceId: ws.id, listId: sup });

        const job = systemPrincipal(ws.id);
        expect(await countUnder(ws.id, [mkt, sup], job.scope)).toBe(2);
        // ...and it may write the report rows it generates.
        expect(can(job.actor, "report.generate", { spaceId: marketing })).toBe(
            true,
        );
        expect(can(job.actor, "report.note", { spaceId: support })).toBe(true);
    });

    it("elevation does not leak past the department it was granted for", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mkt = await makeRbacList(ws.id, marketing, owner.id);
        const sup = await makeRbacList(ws.id, support, owner.id);
        await makeTask({ workspaceId: ws.id, listId: mkt });
        await makeTask({ workspaceId: ws.id, listId: sup });

        const elevated = await policyService().elevateToSpaces(
            "dept_review_stats",
            [marketing],
            ws.id,
        );
        expect(await countUnder(ws.id, [mkt], elevated)).toBe(1);
        expect(await countUnder(ws.id, [sup], elevated)).toBe(0);
    });
});
