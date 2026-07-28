import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { lists, spaces, tasks } from "../../src/db/schema";
import { ListsRepo } from "../../src/repositories/ListsRepo";
import type { EffectiveGrantRow } from "../../src/repositories/UserRolesRepo";
import {
    ALL_VISIBLE,
    NOTHING_VISIBLE,
    describeScope,
    isListVisible,
    isSpaceVisible,
    makeScope,
    materialiseScope,
    scopePredicate,
    seesEverything,
    visibleSpaceIds,
    type ListScopeSource,
    type VisibilityScope,
} from "../../src/rbac/scope";
import type { ActorPermissions } from "../../src/rbac/types";
import { foldGrants } from "../../src/services/PolicyService";
import { makeTask, makeUser, makeWorkspace } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    policyService,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * P8 — `VisibilityScope` + `scopePredicate`.
 *
 * The three rules being pinned here are the ones that decide whether shipping
 * visibility is a no-op or an outage:
 *   unrestricted    -> `undefined`   (SQL must stay BYTE-IDENTICAL to today)
 *   nothing visible -> `1 = 0`       (never `inArray(col, [])`, landmine L3)
 *   some spaces     -> `in (...)`
 */

const ME = "u-me";
const S = "sp-marketing";
const T = "sp-support";

const grant = (
    grantScope: EffectiveGrantRow["grantScope"],
    assignment: "workspace" | string,
    permissionKey = "space.view",
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

/** Render a predicate the way MySQL will actually receive it. */
const renderWhere = (
    where: ReturnType<typeof scopePredicate>,
): { sql: string; params: unknown[] } => {
    const q = getDb().select({ id: tasks.id }).from(tasks).where(where).toSQL();
    return { sql: q.sql, params: q.params };
};

describe("visibleSpaceIds — the space half (pure)", () => {
    it("'all' scope sees the whole workspace", () => {
        expect(visibleSpaceIds(actorFrom([grant("all", "workspace")]))).toEqual({
            kind: "all",
        });
    });

    it("the owner always sees the whole workspace", () => {
        expect(visibleSpaceIds(actorFrom([], true))).toEqual({ kind: "all" });
    });

    it("space-scoped assignments become the visible space set, sorted", () => {
        const actor = actorFrom([grant("space", T), grant("all", S)]);
        expect(visibleSpaceIds(actor)).toEqual({
            kind: "scoped",
            spaceIds: [S, T].sort(),
        });
    });

    it("no space.view grant means no space at all", () => {
        expect(visibleSpaceIds(actorFrom([]))).toEqual({
            kind: "scoped",
            spaceIds: [],
        });
        expect(
            visibleSpaceIds(actorFrom([grant("all", "workspace", "task.edit")])),
        ).toEqual({ kind: "scoped", spaceIds: [] });
    });

    it("a null actor sees nothing", () => {
        expect(visibleSpaceIds(null)).toEqual({ kind: "scoped", spaceIds: [] });
    });

    it("an 'own' grant on space.view is ignored, not turned into reach", () => {
        // The catalog does not offer 'own' for space.view; if a row ever says
        // so, it must not silently widen anything.
        expect(visibleSpaceIds(actorFrom([grant("own", "workspace")]))).toEqual({
            kind: "scoped",
            spaceIds: [],
        });
        expect(visibleSpaceIds(actorFrom([grant("own", S)]))).toEqual({
            kind: "scoped",
            spaceIds: [],
        });
    });
});

describe("scopePredicate — RULE 1: unrestricted emits NO SQL", () => {
    it("returns undefined for an 'all' scope", () => {
        expect(
            scopePredicate(ALL_VISIBLE, { spaceCol: spaces.id }),
        ).toBeUndefined();
        expect(
            scopePredicate(ALL_VISIBLE, { listCol: tasks.primaryListId }),
        ).toBeUndefined();
    });

    it("the query is BYTE-IDENTICAL to one built without visibility", () => {
        const db = getDb();
        const today = db
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.workspaceId, "ws-1"))
            .toSQL();
        const withScope = db
            .select({ id: tasks.id })
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, "ws-1"),
                    scopePredicate(ALL_VISIBLE, {
                        listCol: tasks.primaryListId,
                    }),
                ),
            )
            .toSQL();
        expect(withScope.sql).toBe(today.sql);
        expect(withScope.params).toEqual(today.params);
    });

    it("stays undefined even when extra allow-paths are supplied", () => {
        expect(
            scopePredicate(
                ALL_VISIBLE,
                { listCol: tasks.primaryListId },
                { alsoAllow: [eq(tasks.createdBy, ME)] },
            ),
        ).toBeUndefined();
    });
});

describe("scopePredicate — RULE 2: an empty set is 1 = 0, never in ()", () => {
    it("emits `1 = 0` for a scope with no spaces", () => {
        const r = renderWhere(
            scopePredicate(NOTHING_VISIBLE, { spaceCol: spaces.id }),
        );
        expect(r.sql).toContain("1 = 0");
        expect(r.sql).not.toContain("in ()");
        expect(r.params).toEqual([]);
    });

    it("emits `1 = 0` for a scope with spaces but no lists", () => {
        const scope = makeScope([S], []);
        const r = renderWhere(
            scopePredicate(scope, { listCol: tasks.primaryListId }),
        );
        expect(r.sql).toContain("1 = 0");
    });

    it("matches zero rows against a real table", async () => {
        const ws = await makeWorkspace();
        await makeTask({ workspaceId: ws.id });
        const rows = await getDb()
            .select({ id: tasks.id })
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, ws.id),
                    scopePredicate(NOTHING_VISIBLE, {
                        listCol: tasks.primaryListId,
                    }),
                ),
            );
        expect(rows).toEqual([]);
    });
});

describe("scopePredicate — RULE 3: a scoped set is an IN list", () => {
    it("uses spaceIds for a space column", () => {
        const r = renderWhere(
            scopePredicate(makeScope([T, S], ["l-1"]), { spaceCol: spaces.id }),
        );
        expect(r.sql).toMatch(/in \(\?, \?\)/);
        expect(r.params).toEqual([S, T].sort()); // de-duplicated + sorted
    });

    it("uses listIds for a list column", () => {
        const r = renderWhere(
            scopePredicate(makeScope([S], ["l-2", "l-1", "l-1"]), {
                listCol: tasks.primaryListId,
            }),
        );
        expect(r.params).toEqual(["l-1", "l-2"]);
    });

    it("ORs the extra allow-paths instead of narrowing", () => {
        const r = renderWhere(
            scopePredicate(
                makeScope([S], ["l-1"]),
                { listCol: tasks.primaryListId },
                { alsoAllow: [eq(tasks.createdBy, ME)] },
            ),
        );
        expect(r.sql).toContain(" or ");
        expect(r.sql).not.toContain(" and ");
        expect(r.params).toEqual(["l-1", ME]);
    });

    it("an actor whose ONLY reach is 'own' still gets their own rows", () => {
        // No spaces at all -> without alsoAllow this would be 1 = 0.
        const r = renderWhere(
            scopePredicate(
                NOTHING_VISIBLE,
                { listCol: tasks.primaryListId },
                { alsoAllow: [eq(tasks.createdBy, ME)] },
            ),
        );
        expect(r.sql).not.toContain("1 = 0");
        expect(r.params).toEqual([ME]);
    });

    it("ignores undefined entries in alsoAllow", () => {
        const r = renderWhere(
            scopePredicate(
                NOTHING_VISIBLE,
                { listCol: tasks.primaryListId },
                { alsoAllow: [undefined, undefined] },
            ),
        );
        expect(r.sql).toContain("1 = 0");
    });

    it("filters a real query down to the visible lists", async () => {
        const ws = await makeWorkspace();
        const mine = await makeTask({ workspaceId: ws.id });
        const theirs = await makeTask({ workspaceId: ws.id });

        const rows = await getDb()
            .select({ id: tasks.id })
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, ws.id),
                    scopePredicate(makeScope([], [mine.listId]), {
                        listCol: tasks.primaryListId,
                    }),
                ),
            );
        expect(rows.map((r) => r.id)).toEqual([mine.id]);
        expect(rows.map((r) => r.id)).not.toContain(theirs.id);
    });
});

describe("materialiseScope", () => {
    /** A source that records whether it was consulted. */
    const spySource = (ids: string[] = []) => {
        const calls: { spaceIds: readonly string[]; workspaceId: string }[] =
            [];
        const source: ListScopeSource = {
            idsBySpaces: (spaceIds, workspaceId) => {
                calls.push({ spaceIds, workspaceId });
                return Promise.resolve(ids);
            },
        };
        return { source, calls };
    };

    it("an unrestricted actor costs ZERO queries — today's path", async () => {
        const { source, calls } = spySource();
        const scope = await materialiseScope(
            actorFrom([grant("all", "workspace")]),
            source,
        );
        expect(scope).toEqual(ALL_VISIBLE);
        expect(calls).toHaveLength(0);
    });

    it("an actor with no visible space costs ZERO queries too", async () => {
        const { source, calls } = spySource();
        const scope = await materialiseScope(actorFrom([]), source);
        expect(scope).toEqual(NOTHING_VISIBLE);
        expect(calls).toHaveLength(0);
    });

    it("a null actor sees nothing", async () => {
        const { source, calls } = spySource();
        expect(await materialiseScope(null, spySource().source)).toEqual(
            NOTHING_VISIBLE,
        );
        expect(await materialiseScope(undefined, source)).toEqual(
            NOTHING_VISIBLE,
        );
        expect(calls).toHaveLength(0);
    });

    it("a space-scoped actor pays for exactly one lookup", async () => {
        const { source, calls } = spySource(["l-b", "l-a"]);
        const scope = await materialiseScope(
            actorFrom([grant("space", S), grant("space", T)]),
            source,
        );
        expect(calls).toEqual([
            { spaceIds: [S, T].sort(), workspaceId: "ws-1" },
        ]);
        expect(scope).toEqual({
            kind: "scoped",
            spaceIds: [S, T].sort(),
            listIds: ["l-a", "l-b"],
        });
    });
});

describe("ListsRepo.idsBySpaces — the materialiser's query", () => {
    it("returns every list in the given spaces, archived included", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id });
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const a = await makeRbacList(ws.id, marketing, owner.id);
        const b = await makeRbacList(ws.id, marketing, owner.id);
        const other = await makeRbacList(ws.id, support, owner.id);
        await getDb()
            .update(lists)
            .set({ archivedAt: new Date() })
            .where(eq(lists.id, b));

        const ids = await new ListsRepo(getDb()).idsBySpaces(
            [marketing],
            ws.id,
        );
        expect(ids.sort()).toEqual([a, b].sort());
        expect(ids).not.toContain(other);
    });

    it("returns nothing for a space in ANOTHER workspace (tenant safety)", async () => {
        const a = await makeWorkspace();
        const b = await makeWorkspace();
        const owner = await makeUser({ workspaceId: a.id });
        const spaceInA = await makeRbacSpace(a.id, owner.id);
        await makeRbacList(a.id, spaceInA, owner.id);

        expect(
            await new ListsRepo(getDb()).idsBySpaces([spaceInA], b.id),
        ).toEqual([]);
    });

    it("short-circuits an empty input without a query", async () => {
        expect(await new ListsRepo(getDb()).idsBySpaces([], "ws-x")).toEqual([]);
    });
});

describe("membership helpers (no SQL)", () => {
    const scoped = makeScope([S], ["l-1"]);

    it("seesEverything distinguishes the two kinds", () => {
        expect(seesEverything(ALL_VISIBLE)).toBe(true);
        expect(seesEverything(scoped)).toBe(false);
    });

    it("isSpaceVisible / isListVisible", () => {
        expect(isSpaceVisible(ALL_VISIBLE, "anything")).toBe(true);
        expect(isSpaceVisible(scoped, S)).toBe(true);
        expect(isSpaceVisible(scoped, T)).toBe(false);
        expect(isSpaceVisible(scoped, null)).toBe(false);
        expect(isListVisible(ALL_VISIBLE, null)).toBe(true);
        expect(isListVisible(scoped, "l-1")).toBe(true);
        expect(isListVisible(scoped, "l-9")).toBe(false);
    });

    it("describeScope is log-friendly", () => {
        expect(describeScope(ALL_VISIBLE)).toBe("all");
        expect(describeScope(scoped)).toBe("1 spaces / 1 lists");
    });
});

describe("end to end — a departmental user only sees their department", () => {
    it("resolves to their space + its lists, and filters a real task query", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mktList = await makeRbacList(ws.id, marketing, owner.id);
        const supList = await makeRbacList(ws.id, support, owner.id);
        const mine = await makeTask({ workspaceId: ws.id, listId: mktList });
        const hidden = await makeTask({ workspaceId: ws.id, listId: supList });

        const arif = await userWithPermissions(
            ws,
            [["space.view", "space"], "task.view"],
            { spaceId: marketing },
        );
        const svc = policyService();
        const actor = await svc.resolveActor(arif.id, ws.id);
        const scope = await svc.visibilityFor(actor);

        expect(scope).toEqual({
            kind: "scoped",
            spaceIds: [marketing],
            listIds: [mktList],
        });

        const visibleTasks = await getDb()
            .select({ id: tasks.id })
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, ws.id),
                    scopePredicate(scope, { listCol: tasks.primaryListId }),
                ),
            );
        expect(visibleTasks.map((r) => r.id)).toEqual([mine.id]);
        expect(visibleTasks.map((r) => r.id)).not.toContain(hidden.id);

        // ...and the space listing itself is filtered the same way.
        const visibleSpaces = await getDb()
            .select({ id: spaces.id })
            .from(spaces)
            .where(
                and(
                    eq(spaces.workspaceId, ws.id),
                    scopePredicate(scope, { spaceCol: spaces.id }),
                ),
            );
        expect(visibleSpaces.map((r) => r.id)).toEqual([marketing]);
    });

    it("an owner or admin still sees everything, with no added SQL", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const admin = await userWithSystemRole(ws, "admin");
        const svc = policyService();

        for (const u of [owner, admin]) {
            const actor = await svc.resolveActor(u.id, ws.id);
            const scope = await svc.visibilityFor(actor);
            expect(scope).toEqual(ALL_VISIBLE);
            expect(
                scopePredicate(scope, { listCol: tasks.primaryListId }),
            ).toBeUndefined();
        }
    });

    it("a NEW list in the space is visible immediately (no stale cache)", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const space = await makeRbacSpace(ws.id, owner.id);
        const first = await makeRbacList(ws.id, space, owner.id);
        const u = await userWithPermissions(ws, [["space.view", "space"]], {
            spaceId: space,
        });
        const svc = policyService();
        const actor = await svc.resolveActor(u.id, ws.id);

        const before = await svc.visibilityFor(actor);
        expect(before).toEqual({
            kind: "scoped",
            spaceIds: [space],
            listIds: [first],
        });

        // A list created later must appear WITHOUT a permissions_version bump —
        // list CRUD does not touch RBAC, which is why the scope is never cached.
        const second = await makeRbacList(ws.id, space, owner.id);
        const after = await svc.visibilityFor(actor);
        const seen = after.kind === "scoped" ? [...after.listIds] : [];
        expect(seen.sort()).toEqual([first, second].sort());
    });

    it("a user with a role but no space.view sees nothing at all", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const space = await makeRbacSpace(ws.id, owner.id);
        await makeRbacList(ws.id, space, owner.id);

        const u = await userWithPermissions(ws, ["task.edit"]);
        const svc = policyService();
        const scope = await svc.visibilityFor(
            await svc.resolveActor(u.id, ws.id),
        );
        expect(scope).toEqual(NOTHING_VISIBLE);

        const rows = await getDb()
            .select({ id: spaces.id })
            .from(spaces)
            .where(
                and(
                    eq(spaces.workspaceId, ws.id),
                    scopePredicate(scope, { spaceCol: spaces.id }),
                ),
            );
        expect(rows).toEqual([]);
    });
});

describe("the count query gets the SAME predicate (landmine L2)", () => {
    it("page and count agree on the visible set", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mktList = await makeRbacList(ws.id, marketing, owner.id);
        const supList = await makeRbacList(ws.id, support, owner.id);
        await makeTask({ workspaceId: ws.id, listId: mktList });
        await makeTask({ workspaceId: ws.id, listId: mktList });
        await makeTask({ workspaceId: ws.id, listId: supList });

        const scope: VisibilityScope = makeScope([marketing], [mktList]);
        const where = and(
            eq(tasks.workspaceId, ws.id),
            scopePredicate(scope, { listCol: tasks.primaryListId }),
        );

        const page = await getDb()
            .select({ id: tasks.id })
            .from(tasks)
            .where(where);
        const [counted] = await getDb()
            .select({ total: sql<number>`count(*)` })
            .from(tasks)
            .where(where);

        expect(page).toHaveLength(2);
        expect(Number(counted?.total)).toBe(page.length);
    });
});
