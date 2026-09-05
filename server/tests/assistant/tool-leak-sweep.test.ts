// The OpenAI client is mocked so this suite never makes a real API call.
const mockCreate = jest.fn();
jest.mock("../../src/services/openaiClient", () => ({
    openai: {
        chat: {
            completions: {
                create: (...args: unknown[]) => mockCreate(...args),
            },
        },
    },
    ASSISTANT_MODEL: "gpt-4o-mini",
    ASSISTANT_MAX_OUTPUT_TOKENS: 800,
    createOpenAIClient: () => null,
}));

import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { resetPolicy } from "../../src/rbac/policy";
import { resetAssignmentGate } from "../../src/services/AssignmentRequestsService";
import { ASSISTANT_TOOL_DEFS } from "../../src/assistant/tools";
import type { LoggedInClient } from "../test-utils/app";
import {
    makeStatus,
    makeTask,
    makeTaskType,
} from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "../rbac/helpers";

/**
 * ONE SWEEP OVER EVERY TOOL — the assistant's whole attack surface at once.
 *
 * The individual tool suites each prove their own scoping, and they are the
 * place to debug a failure. What none of them can do is answer the question
 * that matters for a phase gate: **is EVERY tool scoped, including the one
 * somebody adds next year?** A per-tool suite that nobody remembers to write
 * is indistinguishable from a tool that is safe.
 *
 * So this is a table, and the table is checked against `ASSISTANT_TOOL_DEFS`.
 * A thirteenth tool fails this file until its probe exists. That is the same
 * shape as the tenant-isolation sweep's completeness check, for the same
 * reason: the coverage claim is verified rather than asserted.
 *
 * ── the persona ──────────────────────────────────────────────────────────────
 * Deliberately the STRONGEST caller who still must not see the other team:
 * head of Marketing, holding `member.view`, `report.view`, `task.view`,
 * `task.create`, `space.view` and `assistant.use`. Every refusal below is
 * therefore the VISIBILITY SCOPE doing the work — not a missing permission,
 * which would make the whole file pass vacuously if scoping were removed.
 *
 * Every foreign artifact carries its own marker, and each probe names the ones
 * that must not come back. Per-tool rather than one global string, because a
 * tool that ECHOES ITS INPUT is not leaking: asking "create this in ZZFLIST
 * Refunds" and being told "no list matching ZZFLIST Refunds is visible" repeats
 * only what the asker already typed, and is in fact the correct
 * anti-enumeration answer. The first draft of this file used one marker for
 * everything and called all three of those a leak. The distinction is the whole
 * point: a leak is data the caller did NOT supply.
 *
 * Each probe also asserts the caller's OWN data came through (`ZZMINE`), because
 * "the foreign row is absent" proves nothing about a tool that returned nothing.
 */

const CHAT = "/api/v1/assistant/chat";
const db = () => getDb();

// Distinct markers so a probe can forbid the foreign TASK while allowing the
// foreign LIST NAME it passed in as an argument.
const F_TASK = "ZZFTASK";
const F_TEAM = "ZZFTEAM";
const F_LIST = "ZZFLIST";
const F_PERSON = "ZZFPERSON";
/**
 * A foreign task whose pending approval is addressed to SOMEBODY ELSE. It has
 * its own marker because it is the one thing in the other department that no
 * rule permits the caller to see — see the `get_my_approvals` note below.
 */
const F_NOTMINE = "ZZFOTHERS";
/** Everything foreign — the default for a tool that should echo nothing back. */
const ALL_FOREIGN = [F_TASK, F_TEAM, F_LIST, F_PERSON, F_NOTMINE];
/** The caller's own data — its presence is what makes a probe non-vacuous. */
const MINE = "ZZMINE";

jest.setTimeout(120_000);

beforeAll(() => {
    resetPolicy();
    resetAssignmentGate();
});

const modelCalling = (name: string, args: Record<string, unknown> = {}) => {
    const seen: string[] = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation(
        (params: { messages?: { role: string; content?: string }[] }) => {
            const toolMsg = (params.messages ?? []).find(
                (m) => m.role === "tool",
            );
            if (!toolMsg) {
                return Promise.resolve(
                    (async function* () {
                        yield {
                            choices: [
                                {
                                    delta: {
                                        tool_calls: [
                                            {
                                                index: 0,
                                                id: "call_1",
                                                type: "function",
                                                function: {
                                                    name,
                                                    arguments:
                                                        JSON.stringify(args),
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        };
                    })(),
                );
            }
            seen.push(String(toolMsg.content ?? ""));
            return Promise.resolve(
                (async function* () {
                    yield { choices: [{ delta: { content: "ok" } }] };
                })(),
            );
        },
    );
    return seen;
};

/**
 * Run one tool through the REAL route and return the raw JSON the model was
 * shown. That string — not the rendered answer — is the boundary: asserting on
 * prose would test the model's discretion instead of the system's.
 */
const runTool = async (
    client: LoggedInClient,
    tool: string,
    args: Record<string, unknown>,
): Promise<string> => {
    const seen = modelCalling(tool, args);
    const res = await client
        .post(CHAT)
        .set("Accept", "text/event-stream")
        .send({ message: "?" });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    return seen[0];
};

interface World {
    ws: { id: string };
    owner: { id: string; client: LoggedInClient };
    head: { id: string; client: LoggedInClient };
    mineSpace: string;
    mineList: string;
    mineTaskId: string;
    foreignSpace: string;
    foreignList: string;
    foreignTaskId: string;
    foreignPersonId: string;
    foreignPersonName: string;
}

/**
 * Two departments. Everything in the second is marked, and the caller heads
 * the first. Built once — it is ~20 inserts and every probe is read-only.
 */
let world: World;

const buildWorld = async (): Promise<World> => {
    const ws = await rbacWorkspace();
    const owner = await userWithSystemRole(ws, "owner");

    const mineSpace = await makeRbacSpace(ws.id, owner.id, `${MINE} Marketing`);
    const foreignSpace = await makeRbacSpace(
        ws.id,
        owner.id,
        `${F_TEAM} Support`,
    );
    const mineList = await makeRbacList(
        ws.id,
        mineSpace,
        owner.id,
        `${MINE} Campaigns`,
    );
    const foreignList = await makeRbacList(
        ws.id,
        foreignSpace,
        owner.id,
        `${F_LIST} Refunds`,
    );

    const head = await userWithPermissions(
        ws,
        [
            ["space.view", "space"],
            ["task.view", "space"],
            ["task.create", "space"],
            "member.view",
            "report.view",
            "assistant.use",
        ],
        { spaceId: mineSpace },
    );
    // The caller HEADS their own team — the strongest legitimate reader of
    // department reports who is still not an admin.
    await db()
        .update(schema.spaces)
        .set({ headUserId: head.id })
        .where(eq(schema.spaces.id, mineSpace));

    // A colleague who exists ONLY in the other department.
    const foreignPerson = await userWithPermissions(
        ws,
        [["task.view", "own"], "assistant.use"],
        { spaceId: foreignSpace },
    );
    await db()
        .update(schema.users)
        .set({ firstName: F_PERSON, lastName: "Ruma" })
        .where(eq(schema.users.id, foreignPerson.id));
    const foreignPersonName = `${F_PERSON} Ruma`;

    const mineStatus = await makeStatus({ scopeId: mineList });
    const foreignStatus = await makeStatus({ scopeId: foreignList });
    const type = await makeTaskType({ workspaceId: ws.id });

    const mineTask = await makeTask({
        workspaceId: ws.id,
        listId: mineList,
        statusId: mineStatus.id,
        taskTypeId: type.id,
        createdBy: owner.id,
        name: `${MINE} campaign brief`,
    });
    const foreignTask = await makeTask({
        workspaceId: ws.id,
        listId: foreignList,
        statusId: foreignStatus.id,
        taskTypeId: type.id,
        createdBy: owner.id,
        name: `${F_TASK} refund escalation`,
    });

    // Both tasks assigned to the CALLER's counterpart in each team, both due
    // today, both SLA-breached, so every list-shaped tool has something on each
    // side of the boundary to return.
    const assign = async (taskId: string, userId: string) => {
        await db().insert(schema.taskAssignees).values({
            taskId,
            userId,
            assignedBy: owner.id,
        });
    };
    await assign(mineTask.id, head.id);
    await assign(foreignTask.id, foreignPerson.id);

    const breached = new Date(Date.now() - 3 * 3_600_000);
    for (const id of [mineTask.id, foreignTask.id]) {
        await db()
            .update(schema.tasks)
            .set({ dueDate: new Date(), slaDueAt: breached })
            .where(eq(schema.tasks.id, id));
    }

    // A THIRD task, in the other department, whose pending approval is
    // addressed to somebody else entirely. Nothing entitles the caller to see
    // it, so it is the sharp half of the `get_my_approvals` probe.
    const othersTask = await makeTask({
        workspaceId: ws.id,
        listId: foreignList,
        statusId: foreignStatus.id,
        taskTypeId: type.id,
        createdBy: owner.id,
        name: `${F_NOTMINE} someone else's escalation`,
    });

    // Pending approvals: two addressed to the caller (so the tool cannot pass
    // by returning nothing) and one addressed to the foreign colleague.
    const request = async (
        taskId: string,
        spaceId: string,
        targetUserId: string,
    ) => {
        const now = new Date();
        await db()
            .insert(schema.taskAssignmentRequests)
            .values({
                id: fakeId("tar"),
                workspaceId: ws.id,
                spaceId,
                taskId,
                targetUserId,
                requestedBy: owner.id,
                status: "pending",
                expiresAt: new Date(now.getTime() + 7 * 86_400_000),
                createdAt: now,
                updatedAt: now,
            });
    };
    await request(mineTask.id, mineSpace, head.id);
    await request(foreignTask.id, foreignSpace, head.id);
    await request(othersTask.id, foreignSpace, foreignPerson.id);

    // A weekly report for each department.
    for (const spaceId of [mineSpace, foreignSpace]) {
        await db()
            .insert(schema.departmentReports)
            .values({
                id: fakeId("rep"),
                workspaceId: ws.id,
                spaceId,
                weekStart: "2026-08-03",
                weekEnd: "2026-08-09",
                headUserId: spaceId === mineSpace ? head.id : owner.id,
                payload: {},
                generatedAt: new Date(),
            });
    }

    return {
        ws,
        owner,
        head,
        mineSpace,
        mineList,
        mineTaskId: mineTask.id,
        foreignSpace,
        foreignList,
        foreignTaskId: foreignTask.id,
        foreignPersonId: foreignPerson.id,
        foreignPersonName,
    };
};

beforeAll(async () => {
    world = await buildWorld();
});

/**
 * One probe per tool.
 *
 * `args` may be a function so a probe can name a foreign id — the sharpest
 * question there is, because it removes every accident: the caller is not
 * stumbling onto the row, they are asking for it by name.
 *
 * `expectMine` says the probe is non-vacuous (the caller's own data came back).
 * Where a tool CANNOT return the caller's data by construction — a refusal, or
 * a lookup of a foreign id — it is false and the comment says why.
 */
interface Probe {
    tool: string;
    what: string;
    args: (w: World) => Record<string, unknown>;
    /** Markers that must not appear. Defaults to every foreign marker. */
    forbid?: string[];
    expectMine: boolean;
}

const PROBES: Probe[] = [
    {
        tool: "get_my_task_counts",
        what: "workspace-wide counts stop at the caller's reach",
        args: () => ({}),
        // Counts are numbers; there is no name to find. Asserted separately
        // below, where the number itself is checked against the boundary.
        expectMine: false,
    },
    {
        tool: "get_my_tasks",
        what: "the caller's own queue never reaches into the other team",
        args: () => ({ bucket: "open" }),
        expectMine: true,
    },
    {
        tool: "get_task_details",
        what: "a foreign task asked for BY ID is not found",
        args: (w) => ({ task_id: w.foreignTaskId }),
        // A single-row lookup of a foreign id — there is no own-data half.
        expectMine: false,
    },
    {
        tool: "get_my_agenda",
        what: "today's agenda is the caller's, not the company's",
        args: () => ({}),
        expectMine: true,
    },
    {
        tool: "search",
        what: "search spans tasks, lists AND spaces — all three stay inside",
        args: () => ({ query: "ZZ" }),
        expectMine: true,
    },
    {
        tool: "get_people",
        what: "the roster of an invisible team is not readable",
        args: () => ({ action: "team_roster", team_name: `${F_TEAM} Support` }),
        // The team name was supplied by the asker, so echoing it back in "no
        // such team" is not a leak — the MEMBERS are what must not appear.
        forbid: [F_TASK, F_LIST, F_PERSON, F_NOTMINE],
        expectMine: false,
    },
    {
        tool: "get_person_tasks",
        what: "a colleague's task list shows only what the ASKER may see",
        args: (w) => ({ person_name: w.foreignPersonName }),
        // Same: the person's name is the asker's own input. `member.view`
        // legitimately makes the directory readable — what must not come back
        // is their WORK.
        forbid: [F_TASK, F_TEAM, F_LIST, F_NOTMINE],
        expectMine: false,
    },
    {
        tool: "get_team_stats",
        what: "another team's statistics are not readable by name",
        args: () => ({ team_name: `${F_TEAM} Support` }),
        forbid: [F_TASK, F_LIST, F_PERSON, F_NOTMINE],
        expectMine: false,
    },
    {
        tool: "get_my_approvals",
        what: "approvals addressed to the caller — and nobody else's",
        args: () => ({ box: "received" }),
        /**
         * THE ONE NAMED EXCEPTION, and it is deliberate. `AssignmentRequestsRepo`
         * says so in its own header: `taskSnapshotByIds` reads tasks WITHOUT the
         * visibility filter, because "the receiver of a request is, by
         * definition, someone the task's team boundary excludes — they must
         * still see WHAT they are being asked to take on to give informed
         * consent." So a foreign task the caller has been ASKED about is
         * legitimately named here.
         *
         * What that reasoning does NOT cover is a request addressed to someone
         * else, which is why `F_NOTMINE` exists: the exception must stay exactly
         * as wide as its justification.
         */
        forbid: [F_NOTMINE],
        expectMine: true,
    },
    {
        tool: "get_report_status",
        what: "a head reads their OWN department's report and no other",
        args: () => ({}),
        expectMine: true,
    },
    {
        tool: "get_sla_breaches",
        what: "the breach queue is caller-scoped, names and assignees alike",
        args: () => ({}),
        expectMine: true,
    },
    {
        tool: "create_task",
        what: "a task cannot be created into a list the caller cannot see",
        args: () => ({
            name: "sweep probe",
            list_name: `${F_LIST} Refunds`,
        }),
        // The list name is the asker's own words coming back in the refusal.
        forbid: [F_TASK, F_TEAM, F_PERSON, F_NOTMINE],
        expectMine: false,
    },
];

describe("assistant — every tool, one boundary", () => {
    it("covers EVERY tool the model is offered (a 13th tool fails here until probed)", () => {
        // Same cast as `tool-robustness.test.ts`: the OpenAI union now includes
        // a custom-tool variant that has no `.function`, and every tool here is
        // the function kind.
        const offered = ASSISTANT_TOOL_DEFS.map(
            (t) => (t as { function: { name: string } }).function.name,
        ).sort();
        const probed = PROBES.map((p) => p.tool).sort();
        expect(probed).toEqual(offered);
    });

    describe.each(PROBES)("$tool — $what", (probe) => {
        it("never returns the other team's data", async () => {
            const result = await runTool(
                world.head.client,
                probe.tool,
                probe.args(world),
            );

            // THE ASSERTION THIS FILE EXISTS FOR.
            for (const marker of probe.forbid ?? ALL_FOREIGN) {
                expect(result).not.toContain(marker);
            }

            if (probe.expectMine) {
                // …and the probe actually exercised the tool. Without this a
                // tool that returned `{}` would pass the check above.
                expect(result).toContain(MINE);
            }
        });
    });

    it("get_my_task_counts: the workspace-wide number counts only what the caller can see", async () => {
        // The counting tools have no names to leak, so the leak is the NUMBER.
        // This is KI-14's shape — a tile that says 2 where the viewer can open
        // 1 — asked of the assistant instead of the Home page.
        const raw = await runTool(world.head.client, "get_my_task_counts", {});
        const counts = JSON.parse(raw) as Record<string, number>;
        expect(counts.openTasksAcrossTheWholeWorkspace).toBe(1);
        expect(counts.slaBreachesAcrossTheWholeWorkspace).toBe(1);

        // The control: the owner sees both departments — all three tasks, and
        // the two that are SLA-breached. Without this, a tool broken to always
        // answer "1" would pass.
        const asOwner = JSON.parse(
            await runTool(world.owner.client, "get_my_task_counts", {}),
        ) as Record<string, number>;
        expect(asOwner.openTasksAcrossTheWholeWorkspace).toBe(3);
        expect(asOwner.slaBreachesAcrossTheWholeWorkspace).toBe(2);
    });

    it("the unrestricted caller DOES see both — the filter is the caller's, not a blanket", async () => {
        // The guard against the whole file passing because the assistant is
        // broken and returns nothing to anybody.
        const result = await runTool(world.owner.client, "search", {
            query: "ZZ",
        });
        expect(result).toContain(MINE);
        expect(result).toContain(F_TASK);
    });
});

/**
 * Anti-enumeration (§P9 task 3). Absence is not enough on its own: a tool that
 * withholds the row while confirming it exists — "you cannot see THAT task" —
 * has still answered the attacker's real question, which was whether it is
 * there at all. A hidden thing and a non-existent thing must be indistinguishable.
 */
describe("assistant — a hidden thing answers exactly like a missing thing", () => {
    const pairs: Array<{
        tool: string;
        hidden: (w: World) => Record<string, unknown>;
        absent: Record<string, unknown>;
    }> = [
        {
            tool: "get_task_details",
            hidden: (w) => ({ task_id: w.foreignTaskId }),
            absent: { task_id: "tsk_does_not_exist_at_all" },
        },
        {
            tool: "get_people",
            hidden: () => ({
                action: "team_roster",
                team_name: `${F_TEAM} Support`,
            }),
            absent: { action: "team_roster", team_name: "Nonexistent Team" },
        },
        {
            tool: "get_team_stats",
            hidden: () => ({ team_name: `${F_TEAM} Support` }),
            absent: { team_name: "Nonexistent Team" },
        },
    ];

    it.each(pairs)(
        "$tool answers the same for a hidden one as for an invented one",
        async ({ tool, hidden, absent }) => {
            const hiddenResult = await runTool(
                world.head.client,
                tool,
                hidden(world),
            );
            const absentResult = await runTool(world.head.client, tool, absent);

            // Compare the SHAPE, not the text: an honest refusal echoes back
            // the name it was given ("no team called X"), which differs between
            // the two by construction. What must match is the verdict — the
            // error code and whether anything was returned at all.
            const shapeOf = (raw: string) => {
                const o = JSON.parse(raw) as Record<string, unknown>;
                return {
                    error: o.error ?? null,
                    code: o.code ?? null,
                    hasData: Object.keys(o).some(
                        (k) => !["error", "code", "say", "note"].includes(k),
                    ),
                };
            };
            expect(shapeOf(hiddenResult)).toEqual(shapeOf(absentResult));

            // …and nothing BEHIND the hidden thing comes back with it. The
            // team's own name is the asker's input echoed, so it is excluded;
            // its tasks, lists and people are not.
            for (const marker of [F_TASK, F_LIST, F_PERSON, F_NOTMINE]) {
                expect(hiddenResult).not.toContain(marker);
            }
        },
    );

    /**
     * The person half, which is NOT anti-enumeration and was wrong in the first
     * draft of this file.
     *
     * `member.view` is a workspace-wide directory permission: a colleague in
     * another department is legitimately findable by name, and `get_people`'s
     * `find_person` is built to say so while counting rather than naming the
     * teams they belong to. So a hidden PERSON is not meant to look like a
     * missing one — what must stay hidden is their WORK.
     */
    it("a colleague in another team resolves, but their work does not come with them", async () => {
        const raw = await runTool(world.head.client, "get_person_tasks", {
            person_name: world.foreignPersonName,
        });
        const result = JSON.parse(raw) as Record<string, unknown>;

        expect(result.person).toBe(world.foreignPersonName);
        expect(result.count).toBe(0);
        expect(result.tasks).toEqual([]);
        // And the tool says WHY the zero is not "they have nothing to do" —
        // a number the reader would otherwise misread as a fact about the
        // person rather than about their own reach.
        expect(String(result.note)).toContain("ONLY tasks you may see");
        expect(raw).not.toContain(F_TASK);
    });
});
