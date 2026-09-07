import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import {
    makeList,
    makeSpace,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";

/**
 * §P12 task 6 — the two `ON DELETE RESTRICT` paths.
 *
 * Almost every foreign key in this schema cascades. Two deliberately do not,
 * and the test plan names them because they are the ones that stop history
 * being quietly destroyed: a Space that has been reported on, and a List that
 * still holds tasks. Nothing in TypeScript enforces either — they are MySQL
 * rules, so only a real delete against a real database can assert them.
 *
 * §A rule 3 records the operational consequence, which is why this matters
 * beyond tidiness: an API-based teardown CANNOT remove these rows, so every
 * phase's cleanup has to run in FK order. A migration that "helpfully"
 * relaxed either constraint would make that rule silently unnecessary — and
 * make a stray list-delete take a month of tasks with it.
 *
 * Each rule gets its control case. Without one, a schema that refused to
 * delete ANY list would pass the first test while being badly broken.
 *
 * ── what is deliberately NOT here ───────────────────────────────────────────
 * The task-6 line also asks for the 022 checklist counters "recomputed from
 * truth". That already exists, against the real mechanism, in
 * `tests/checklists/counter-truth.test.ts` — it drives the public API through
 * a mixed run of every mutating path and compares the stored counter to a live
 * COUNT. A first draft of this file re-tested it here by inserting rows
 * straight through Drizzle and expecting the numbers to move; they did not,
 * because the rollup is maintained by `TasksRepo.recomputeChecklistCounters`
 * inside each `ChecklistsService` write transaction, NOT by a trigger. The
 * gap that survived — a future write path that forgets to recompute — is
 * pinned by `tests/checklists/write-paths-recompute.test.ts` instead, next to
 * the code it guards.
 */

const db = () => getDb();

describe("ON DELETE RESTRICT — the two paths that refuse", () => {
    it("a List holding tasks cannot be deleted (tasks.primary_list_id)", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });
        const list = await makeList({
            workspaceId: ws.id,
            spaceId: space.id,
            createdBy: owner.id,
        });
        await makeTask({
            workspaceId: ws.id,
            listId: list.id,
            createdBy: owner.id,
        });

        await expect(
            db().delete(schema.lists).where(eq(schema.lists.id, list.id)),
        ).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });

        // …and the list is still there. A refused delete that half-happened
        // would be worse than either outcome.
        const rows = await db()
            .select({ id: schema.lists.id })
            .from(schema.lists)
            .where(eq(schema.lists.id, list.id));
        expect(rows).toHaveLength(1);
    });

    it("an empty List CAN be deleted — the rule is about tasks, not lists", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });
        const list = await makeList({
            workspaceId: ws.id,
            spaceId: space.id,
            createdBy: owner.id,
        });

        await db().delete(schema.lists).where(eq(schema.lists.id, list.id));
        const rows = await db()
            .select({ id: schema.lists.id })
            .from(schema.lists)
            .where(eq(schema.lists.id, list.id));
        expect(rows).toHaveLength(0);
    });

    it("a Space that has been reported on cannot be deleted (department_reports.space_id)", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });
        await db()
            .insert(schema.departmentReports)
            .values({
                id: fakeId("rep"),
                workspaceId: ws.id,
                spaceId: space.id,
                weekStart: "2026-08-03",
                weekEnd: "2026-08-09",
                headUserId: owner.id,
                payload: {},
                generatedAt: new Date(),
            });

        await expect(
            db().delete(schema.spaces).where(eq(schema.spaces.id, space.id)),
        ).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
    });

    it("a Space with no report CAN be deleted — the control", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });

        await db().delete(schema.spaces).where(eq(schema.spaces.id, space.id));
        const rows = await db()
            .select({ id: schema.spaces.id })
            .from(schema.spaces)
            .where(eq(schema.spaces.id, space.id));
        expect(rows).toHaveLength(0);
    });

    it("the constraints are declared RESTRICT in this database, not merely observed", async () => {
        // The behavioural tests above would also pass against a NO ACTION rule
        // or an application-level check. This reads the rule itself, so the
        // finding survives someone "simplifying" the delete path later.
        const rows = (await db().execute(
            `SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE, k.TABLE_NAME, k.COLUMN_NAME
               FROM information_schema.REFERENTIAL_CONSTRAINTS rc
               JOIN information_schema.KEY_COLUMN_USAGE k
                 ON k.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
                AND k.CONSTRAINT_NAME  = rc.CONSTRAINT_NAME
              WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
                AND ((k.TABLE_NAME = 'tasks' AND k.COLUMN_NAME = 'primary_list_id')
                  OR (k.TABLE_NAME = 'department_reports' AND k.COLUMN_NAME = 'space_id'))`,
        )) as unknown as Array<
            Array<{ DELETE_RULE: string; TABLE_NAME: string }>
        >;
        const found = (Array.isArray(rows[0]) ? rows[0] : []) as Array<{
            DELETE_RULE: string;
            TABLE_NAME: string;
        }>;

        // Vacuity guard: an empty result would make every assertion below pass.
        expect(found.map((r) => r.TABLE_NAME).sort()).toEqual([
            "department_reports",
            "tasks",
        ]);
        for (const r of found) {
            expect({ [r.TABLE_NAME]: r.DELETE_RULE }).toEqual({
                [r.TABLE_NAME]: "RESTRICT",
            });
        }
    });
});
