import { fakeId } from "../../src/utils";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";
import {
    makeList,
    makeLoggedInClient,
    makeSpace,
    makeStatus,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";

/**
 * What `GET /search` does with the characters people actually type.
 *
 * Two gaps this closes. The suite had **no non-ASCII term anywhere**, in a
 * product whose staff write task names in Bangla — so nothing established that
 * search works at all for most of what is in this database. And `escapeLike`
 * escapes three characters (`\`, `%`, `_`) while only `%` was ever tested; `_`
 * is SQL's single-character wildcard, so an unescaped one silently turns a
 * search for `Q3_report` into a search for `Q3?report`.
 *
 * Test NAMES stay ASCII on purpose — the Bangla lives in the data, so a jest
 * run stays readable in a terminal that cannot render it.
 */

jest.setTimeout(30_000);

const SEARCH = "/api/v1/search";

const scene = async () => {
    const ws = await makeWorkspace();
    const actor = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(actor);
    const space = await makeSpace({ workspaceId: ws.id, createdBy: actor.id });
    const list = await makeList({
        workspaceId: ws.id,
        spaceId: space.id,
        createdBy: actor.id,
    });
    const status = await makeStatus({ scopeId: list.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    return { ws, actor, client, space, list, status, taskType };
};
type Scene = Awaited<ReturnType<typeof scene>>;

let seq = 0;
const seedTask = async (s: Scene, name: string): Promise<string> => {
    const id = fakeId("t");
    await getDb()
        .insert(tasks)
        .values({
            id,
            workspaceId: s.ws.id,
            primaryListId: s.list.id,
            taskNumber: ++seq + 9000,
            name,
            statusId: s.status.id,
            taskTypeId: s.taskType.id,
            createdBy: s.actor.id,
        });
    return id;
};

const find = async (s: Scene, q: string): Promise<string[]> => {
    const res = await s.client.get(
        `${SEARCH}?q=${encodeURIComponent(q)}&types=task`,
    );
    expect(res.status).toBe(200);
    return (res.body.tasks as Array<{ id: string }>).map((t) => t.id);
};

// Bangla for "Eid campaign", "product photoshoot", "delivery".
const EID = "ঈদ ক্যাম্পেইন";
const SHOOT = "পণ্যের ফটোশুট";
const DELIVERY = "ডেলিভারি";

describe("search terms that are not plain ASCII", () => {
    it("finds a Bangla-named task by its full Bangla name", async () => {
        const s = await scene();
        const id = await seedTask(s, EID);
        await seedTask(s, SHOOT);

        expect(await find(s, EID)).toEqual([id]);
    });

    it("finds a Bangla name by a Bangla substring", async () => {
        const s = await scene();
        const id = await seedTask(s, EID);

        // The second word alone.
        expect(await find(s, EID.split(" ")[1])).toEqual([id]);
    });

    it("does not match a DIFFERENT Bangla word", async () => {
        const s = await scene();
        await seedTask(s, EID);

        expect(await find(s, DELIVERY)).toEqual([]);
    });

    it("finds a mixed Bangla + English name from either half", async () => {
        const s = await scene();
        const id = await seedTask(s, `${DELIVERY} SLA report`);

        expect(await find(s, DELIVERY)).toEqual([id]);
        expect(await find(s, "SLA report")).toEqual([id]);
    });

    it("handles an emoji in the name without matching everything", async () => {
        const s = await scene();
        const withEmoji = await seedTask(s, "Launch 🚀 checklist");
        await seedTask(s, "Launch checklist");

        expect(await find(s, "🚀")).toEqual([withEmoji]);
    });

    it("is case-insensitive for ASCII, which Bangla has no notion of", async () => {
        const s = await scene();
        const id = await seedTask(s, "Quarterly REVIEW");

        expect(await find(s, "quarterly review")).toEqual([id]);
    });
});

describe("LIKE wildcards in the query are literal", () => {
    it("treats _ as a literal underscore, not any-single-character", async () => {
        const s = await scene();
        const literal = await seedTask(s, "Q3_report");
        await seedTask(s, "Q3-report");
        await seedTask(s, "Q3xreport");

        // `_` unescaped would match all three.
        expect(await find(s, "Q3_report")).toEqual([literal]);
    });

    it("treats % as a literal percent", async () => {
        const s = await scene();
        const literal = await seedTask(s, "Discount 20% banner");
        await seedTask(s, "Discount 20 banner");

        expect(await find(s, "20%")).toEqual([literal]);
    });

    it("treats a backslash as a literal backslash", async () => {
        const s = await scene();
        const literal = await seedTask(s, "path\\to\\asset");
        await seedTask(s, "path to asset");

        expect(await find(s, "path\\to")).toEqual([literal]);
    });

    it("a query of only wildcards matches only a name containing them", async () => {
        const s = await scene();
        const weird = await seedTask(s, "100%_done");
        await seedTask(s, "Ordinary task");

        expect(await find(s, "%_")).toEqual([weird]);
    });
});
