import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import { makeTask } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * KI-18 — what `task.view` scope `own` actually does.
 *
 * The ledger recorded it as "offered by the roles UI but never narrows reads",
 * and asked P7 to prove that, then decide: enforce it, or drop it from the
 * catalog so the UI stops promising something.
 *
 * Measured, and the entry is literally correct — but the reason is more
 * interesting than "it does nothing", and the fix is not either of the two
 * options, so this file pins the real semantics instead:
 *
 *   **Row visibility comes from `space.view`, not from `task.view`.**
 *   `context.ts` says so — *"unrestricted … which is every user until an admin
 *   narrows `space.view`"*. `task.view`'s scope controls one thing only:
 *   whether `taskOwnEscape()` contributes its predicates, which are OR-ed into
 *   the space filter and therefore only ever ADD rows.
 *
 * So `own` on `task.view` is a WIDENING, not a narrowing, and it is inert until
 * `space.view` has been narrowed. An admin who sets it expecting "this person
 * sees only their own tasks" gets the opposite of what they intended. The
 * catalog's own prose is honest about this — *"a person still sees tasks they
 * created or are assigned to even outside their spaces"* — so the text is
 * right and the scope-selector metaphor is what misleads.
 *
 * Three combinations, which together are the whole behaviour.
 */

beforeAll(() => resetPolicy());

jest.setTimeout(60_000);

const db = () => getDb();

/** Two teams, four tasks: two strangers', one the actor made, one they hold. */
const scene = async () => {
    const ws = await rbacWorkspace();
    const admin = await userWithSystemRole(ws, "admin");
    const alpha = await makeRbacSpace(ws.id, admin.id, "Alpha");
    const beta = await makeRbacSpace(ws.id, admin.id, "Beta");
    const listAlpha = await makeRbacList(ws.id, alpha, admin.id);
    const listBeta = await makeRbacList(ws.id, beta, admin.id);
    return { ws, admin, alpha, beta, listAlpha, listBeta };
};

type Scene = Awaited<ReturnType<typeof scene>>;

const seedTasks = async (s: Scene, actorId: string) => {
    const strangerInAlpha = await makeTask({
        workspaceId: s.ws.id,
        listId: s.listAlpha,
        createdBy: s.admin.id,
        name: "Alpha's own business",
    });
    const strangerInBeta = await makeTask({
        workspaceId: s.ws.id,
        listId: s.listBeta,
        createdBy: s.admin.id,
        name: "Beta's own business",
    });
    const iCreatedInBeta = await makeTask({
        workspaceId: s.ws.id,
        listId: s.listBeta,
        createdBy: actorId,
        name: "Bug I filed into Beta",
    });
    const iWasGivenInBeta = await makeTask({
        workspaceId: s.ws.id,
        listId: s.listBeta,
        createdBy: s.admin.id,
        name: "Work Beta handed me",
    });
    await db()
        .insert(schema.taskAssignees)
        .values({ taskId: iWasGivenInBeta.id, userId: actorId });
    return {
        strangerInAlpha,
        strangerInBeta,
        iCreatedInBeta,
        iWasGivenInBeta,
    };
};

/** Which of the four a caller can actually open, by name. */
const visibleNames = async (
    client: { get: (u: string) => Promise<{ status: number; body: unknown }> },
    tasks: Awaited<ReturnType<typeof seedTasks>>,
): Promise<string[]> => {
    const out: string[] = [];
    for (const [label, t] of Object.entries(tasks)) {
        const res = await client.get(`/api/v1/tasks/${t.id}`);
        if (res.status === 200) out.push(label);
        else if (res.status !== 404) {
            throw new Error(`${label}: unexpected ${res.status}`);
        }
    }
    return out.sort();
};

describe("KI-18 — `task.view` scope `own` widens, it does not narrow", () => {
    it("with space.view ALL, `own` changes nothing — every task is readable", async () => {
        const s = await scene();
        const viewer = await userWithPermissions(s.ws, [
            ["task.view", "own"],
            ["space.view", "all"],
        ]);
        const tasks = await seedTasks(s, viewer.id);

        expect(await visibleNames(viewer.client, tasks)).toEqual([
            "iCreatedInBeta",
            "iWasGivenInBeta",
            "strangerInAlpha",
            "strangerInBeta",
        ]);
    });

    it("with space.view narrowed to Alpha, `own` ADDS their Beta tasks", async () => {
        const s = await scene();
        const viewer = await userWithPermissions(
            s.ws,
            [
                ["task.view", "own"],
                ["space.view", "space"],
            ],
            { spaceId: s.alpha },
        );
        const tasks = await seedTasks(s, viewer.id);

        // Alpha's task because it is in their space; the two Beta tasks
        // because they made one and hold the other. Not the Beta stranger.
        expect(await visibleNames(viewer.client, tasks)).toEqual([
            "iCreatedInBeta",
            "iWasGivenInBeta",
            "strangerInAlpha",
        ]);
    });

    it("with space.view narrowed and task.view ALL, the Beta tasks disappear", async () => {
        const s = await scene();
        const viewer = await userWithPermissions(
            s.ws,
            [
                ["task.view", "all"],
                ["space.view", "space"],
            ],
            { spaceId: s.alpha },
        );
        const tasks = await seedTasks(s, viewer.id);

        // The contrast that makes the point: dropping `own` REMOVES rows.
        // A scope selector that adds reach when you pick the narrowest option
        // is the part worth knowing about.
        expect(await visibleNames(viewer.client, tasks)).toEqual([
            "strangerInAlpha",
        ]);
    });

    describe("the Home tile agrees with what is readable", () => {
        it("counts the own-escape tasks, not just the caller's spaces", async () => {
            const s = await scene();
            const viewer = await userWithPermissions(
                s.ws,
                [
                    ["task.view", "own"],
                    ["space.view", "space"],
                ],
                { spaceId: s.alpha },
            );
            await seedTasks(s, viewer.id);

            const kpis = await viewer.client.get("/api/v1/home/kpis");

            expect(kpis.status).toBe(200);
            // Three tasks are openable, so three is what the tile must say.
            // `openTeamSeries` used the space filter WITHOUT the own-escape,
            // so it counted one — a tile contradicting the app around it, the
            // same shape as KI-14. Fixed in P7.
            expect(kpis.body.openTeamTasks.value).toBe(3);
        });
    });
});
