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
import type { LoggedInClient } from "../test-utils/app";
import { makeStatus, makeTask, makeTaskType } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "../rbac/helpers";

/**
 * PEOPLE, APPROVALS, REPORTS, SLA — the assistant's team-data tools
 * (AI_ASSISTANT_DEEP_PLAN.md P4–P6).
 *
 * The thing these must never do is become a back door. Each surface is gated
 * at the HTTP layer by `requirePermission`, and the tool path does NOT pass
 * through those routes — so every tool asserts the permission ITSELF, and
 * these tests are the proof. They also pin the anti-enumeration rule: a team
 * or task the caller cannot see must answer the same way as one that does not
 * exist, with no name echoed back.
 *
 * Same harness as `scoping.test.ts`: the mocked model is forced to call a tool
 * through the REAL route, so the AsyncLocalStorage RBAC context is production's.
 */

const CHAT = "/api/v1/assistant/chat";
const db = () => getDb();

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

const ask = async (
    client: LoggedInClient,
    seen: string[],
): Promise<Record<string, unknown>> => {
    const res = await client
        .post(CHAT)
        .set("Accept", "text/event-stream")
        .send({ message: "?" });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    return JSON.parse(seen[0]) as Record<string, unknown>;
};

const nameOf = async (userId: string): Promise<string> => {
    const [u] = await db()
        .select({ f: schema.users.firstName, l: schema.users.lastName })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
    return `${u.f} ${u.l}`.trim();
};

/** Two teams; the member belongs to Marketing only and heads nothing. */
const seed = async () => {
    const ws = await rbacWorkspace();
    const owner = await userWithSystemRole(ws, "owner");
    const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
    const support = await makeRbacSpace(ws.id, owner.id, "Customer Service");
    const member = await userWithPermissions(
        ws,
        [
            ["space.view", "space"],
            ["task.view", "space"],
            "assistant.use",
            "member.view",
        ],
        { spaceId: marketing },
    );
    return { ws, owner, marketing, support, member };
};

describe("get_people — teams and colleagues, gated on member.view", () => {
    it("REFUSES every mode without member.view, naming the permission", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        // Can see their space and its tasks — but not the member directory.
        const blind = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                "assistant.use",
            ],
            { spaceId: marketing },
        );

        for (const action of [
            "my_teams",
            "team_roster",
            "find_person",
            "person_workload",
        ]) {
            const seen = modelCalling("get_people", {
                action,
                team_name: "Marketing",
                person_name: "@me",
            });
            const result = await ask(blind.client, seen);
            expect(result.permission).toBe("member.view");
            expect(result.reason).toBe("no_grant");
            expect(String(result.error)).toMatch(/permission/i);
        }
    });

    it("my_teams lists the caller's own teams and each head", async () => {
        const s = await seed();
        await db()
            .update(schema.spaces)
            .set({ headUserId: s.owner.id })
            .where(eq(schema.spaces.id, s.marketing));

        const seen = modelCalling("get_people", { action: "my_teams" });
        const result = await ask(s.member.client, seen);

        expect(result.count).toBe(1);
        const [team] = result.teams as Array<Record<string, unknown>>;
        expect(team.team).toBe("Marketing");
        expect(team.head).toBe(await nameOf(s.owner.id));
        expect(team.youAreHead).toBe(false);
        // Customer Service is not theirs and must not appear at all.
        expect(JSON.stringify(result)).not.toContain("Customer Service");
    });

    it("team_roster answers for a visible team, and hides an invisible one", async () => {
        const s = await seed();
        const colleague = await userWithPermissions(
            s.ws,
            [["space.view", "space"], "assistant.use"],
            { spaceId: s.marketing },
        );

        const mine = modelCalling("get_people", {
            action: "team_roster",
            team_name: "Marketing",
        });
        const ours = await ask(s.member.client, mine);
        expect(ours.team).toBe("Marketing");
        const names = (ours.members as Array<{ name: string }>).map(
            (m) => m.name,
        );
        expect(names).toContain(await nameOf(colleague.id));

        // The team they are NOT on: refuse exactly like a team that does not
        // exist, and echo nothing back.
        const theirs = modelCalling("get_people", {
            action: "team_roster",
            team_name: "Customer Service",
        });
        const denied = await ask(s.member.client, theirs);
        expect(denied.error).toBe("not_found");
        expect(JSON.stringify(denied)).not.toContain("Customer Service");
    });

    it("find_person names only the teams the ASKER can see, and counts the rest", async () => {
        const s = await seed();
        // On both teams; the asker may only see Marketing.
        const crossTeam = await userWithPermissions(
            s.ws,
            [["space.view", "space"], "assistant.use"],
            { spaceId: s.marketing },
        );
        await db().insert(schema.userRoleGrants).values({
            id: fakeId("urg"),
            workspaceId: s.ws.id,
            userId: crossTeam.id,
            roleId: s.ws.systemRoleIds.member,
            scopeType: "space",
            scopeId: s.support,
        });

        const seen = modelCalling("get_people", {
            action: "find_person",
            person_name: await nameOf(crossTeam.id),
        });
        const result = await ask(s.member.client, seen);

        expect((result.teams as Array<{ team: string }>).map((t) => t.team)).toEqual(
            ["Marketing"],
        );
        // The hidden team is a COUNT, never a name.
        expect(result.hiddenTeams).toBe(1);
        expect(JSON.stringify(result)).not.toContain("Customer Service");
    });

    it("person_workload counts only tasks the ASKER can see (D5: a number, not a list)", async () => {
        const s = await seed();
        const colleague = await userWithPermissions(
            s.ws,
            [["space.view", "space"], "assistant.use"],
            { spaceId: s.marketing },
        );
        const type = await makeTaskType({ workspaceId: s.ws.id });
        const mkTask = async (spaceId: string, name: string) => {
            const listId = await makeRbacList(
                s.ws.id,
                spaceId,
                s.owner.id,
                `List ${name}`,
            );
            const st = await makeStatus({ scopeId: listId });
            const t = await makeTask({
                workspaceId: s.ws.id,
                listId,
                statusId: st.id,
                taskTypeId: type.id,
                createdBy: s.owner.id,
                name,
            });
            await db().insert(schema.taskAssignees).values({
                taskId: t.id,
                userId: colleague.id,
                assignedBy: s.owner.id,
            });
        };
        await mkTask(s.marketing, "Visible one");
        await mkTask(s.support, "Hidden one");

        const seen = modelCalling("get_people", {
            action: "person_workload",
            person_name: await nameOf(colleague.id),
        });
        const result = await ask(s.member.client, seen);

        expect(result.openTasksYouCanSee).toBe(1); // not 2
        expect(result.person).toBe(await nameOf(colleague.id));
    });
});

describe("create_task — naming an assignee reads the directory, so it needs member.view (G7)", () => {
    const seedForCreate = async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const space = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const listId = await makeRbacList(ws.id, space, owner.id, "Campaign");
        await makeStatus({ scopeId: listId });
        await makeTaskType({ workspaceId: ws.id });
        return { ws, owner, space, listId };
    };

    it("refuses to resolve a NAMED assignee without member.view", async () => {
        const s = await seedForCreate();
        const noDirectory = await userWithPermissions(
            s.ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                ["task.create", "space"],
                "assistant.use",
            ],
            { spaceId: s.space },
        );

        const seen = modelCalling("create_task", {
            name: "gated by member.view",
            list_name: "Campaign",
            assignee_names: ["Someone Else"],
        });
        const result = await ask(noDirectory.client, seen);

        expect(result.permission).toBe("member.view");
        expect(result.created).toBeUndefined();
        const rows = await db()
            .select()
            .from(schema.tasks)
            .where(eq(schema.tasks.name, "gated by member.view"));
        expect(rows).toHaveLength(0);
    });

    it('still allows "@me" without it — that reads only the caller\'s own row', async () => {
        const s = await seedForCreate();
        const noDirectory = await userWithPermissions(
            s.ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                ["task.create", "space"],
                "assistant.use",
            ],
            { spaceId: s.space },
        );

        const seen = modelCalling("create_task", {
            name: "self assign no directory",
            list_name: "Campaign",
            assignee_names: ["@me"],
        });
        const result = await ask(noDirectory.client, seen);

        expect(result.created).toBe(true);
        expect((result.assigned as string[]).length).toBe(1);
    });
});

describe("get_my_approvals — relationship-scoped, read-only", () => {
    /** A pending cross-team request: owner asks `target` to join `taskId`. */
    const pendingRequest = async (input: {
        wsId: string;
        spaceId: string;
        taskId: string;
        targetUserId: string;
        requestedBy: string;
    }) => {
        const now = new Date();
        await db()
            .insert(schema.taskAssignmentRequests)
            .values({
                id: fakeId("tar"),
                workspaceId: input.wsId,
                spaceId: input.spaceId,
                taskId: input.taskId,
                targetUserId: input.targetUserId,
                requestedBy: input.requestedBy,
                status: "pending",
                expiresAt: new Date(now.getTime() + 7 * 86_400_000),
                createdAt: now,
                updatedAt: now,
            });
    };

    const seedRequest = async () => {
        const s = await seed();
        const listId = await makeRbacList(
            s.ws.id,
            s.marketing,
            s.owner.id,
            "Eid Campaign",
        );
        const st = await makeStatus({ scopeId: listId });
        const type = await makeTaskType({ workspaceId: s.ws.id });
        const task = await makeTask({
            workspaceId: s.ws.id,
            listId,
            statusId: st.id,
            taskTypeId: type.id,
            createdBy: s.owner.id,
            name: "Needs a specialist",
        });
        await pendingRequest({
            wsId: s.ws.id,
            spaceId: s.marketing,
            taskId: task.id,
            targetUserId: s.member.id,
            requestedBy: s.owner.id,
        });
        return { ...s, task };
    };

    it("the TARGET sees it in their received box, with the task and who asked", async () => {
        const s = await seedRequest();
        const seen = modelCalling("get_my_approvals", { box: "received" });
        const result = await ask(s.member.client, seen);

        expect(result.box).toBe("received");
        expect(result.count).toBe(1);
        expect(result.decideAt).toBe("/inbox");
        const [r] = result.requests as Array<Record<string, unknown>>;
        expect(r.task).toBe("Needs a specialist");
        expect(r.requestedBy).toBe(await nameOf(s.owner.id));
        expect(r.status).toBe("pending");
        expect(String(r.url)).toMatch(/^\/t\//);
    });

    it("the REQUESTER sees it in sent, and an unrelated member sees nothing (not an error)", async () => {
        const s = await seedRequest();

        const sent = modelCalling("get_my_approvals", { box: "sent" });
        const mine = await ask(s.owner.client, sent);
        expect(mine.count).toBe(1);

        const stranger = await userWithPermissions(s.ws, [
            ["task.view", "own"],
            "assistant.use",
        ]);
        const empty = modelCalling("get_my_approvals", { box: "received" });
        const none = await ask(stranger.client, empty);
        expect(none.count).toBe(0);
        expect(none.error).toBeUndefined();
    });
});

describe("get_report_status — the reports the caller may actually read", () => {
    const makeReport = async (wsId: string, spaceId: string, headId: string | null) => {
        await db()
            .insert(schema.departmentReports)
            .values({
                id: fakeId("rep"),
                workspaceId: wsId,
                spaceId,
                weekStart: "2026-08-03",
                weekEnd: "2026-08-09",
                headUserId: headId,
                payload: {},
                generatedAt: new Date(),
            });
    };

    it("REFUSES a member who neither holds report.view nor heads a team", async () => {
        const s = await seed();
        await makeReport(s.ws.id, s.marketing, s.owner.id);

        const seen = modelCalling("get_report_status", {});
        const result = await ask(s.member.client, seen);

        expect(result.permission).toBe("report.view");
        // …and it must not leak that a report exists.
        expect(JSON.stringify(result)).not.toContain("2026-08-03");
    });

    it("a HEAD reads their own team's report without holding the permission", async () => {
        const s = await seed();
        await db()
            .update(schema.spaces)
            .set({ headUserId: s.member.id })
            .where(eq(schema.spaces.id, s.marketing));
        await makeReport(s.ws.id, s.marketing, s.member.id);
        await makeReport(s.ws.id, s.support, s.owner.id);

        const seen = modelCalling("get_report_status", {});
        const result = await ask(s.member.client, seen);

        expect(result.count).toBe(1);
        const [r] = result.reports as Array<Record<string, unknown>>;
        expect(r.team).toBe("Marketing");
        expect(r.week).toBe("2026-08-03 – 2026-08-09");
        expect(r.seen).toBe(false);
        expect(JSON.stringify(result)).not.toContain("Customer Service");
    });

    it("the owner sees every department's report", async () => {
        const s = await seed();
        await makeReport(s.ws.id, s.marketing, null);
        await makeReport(s.ws.id, s.support, null);

        const seen = modelCalling("get_report_status", {});
        const result = await ask(s.owner.client, seen);

        expect(result.count).toBe(2);
    });

    it("a head with NO reports yet is told they CAN read — not that they lack permission", async () => {
        // A live probe caught the model turning an empty list into "দুঃখিত,
        // আপনি রিপোর্ট দেখতে পারেন না" and telling a department Head to go ask
        // her own Head. The verdict now travels with the data.
        const s = await seed();
        await db()
            .update(schema.spaces)
            .set({ headUserId: s.member.id })
            .where(eq(schema.spaces.id, s.marketing));

        const seen = modelCalling("get_report_status", {});
        const result = await ask(s.member.client, seen);

        expect(result.count).toBe(0);
        expect(result.youCanReadReports).toBe(true);
        expect(result.permission).toBeUndefined();
        expect(String(result.note)).toContain("CAN read reports");
    });
});

describe("get_sla_breaches — only what the caller can see", () => {
    it("lists a breached task, in hours late, with a link", async () => {
        const s = await seed();
        const listId = await makeRbacList(
            s.ws.id,
            s.marketing,
            s.owner.id,
            "Complaints",
        );
        const st = await makeStatus({ scopeId: listId });
        const type = await makeTaskType({ workspaceId: s.ws.id });
        const t = await makeTask({
            workspaceId: s.ws.id,
            listId,
            statusId: st.id,
            taskTypeId: type.id,
            createdBy: s.owner.id,
            name: "Late complaint",
        });
        await db()
            .update(schema.tasks)
            .set({ slaDueAt: new Date(Date.now() - 3 * 3_600_000) })
            .where(eq(schema.tasks.id, t.id));

        const seen = modelCalling("get_sla_breaches", {});
        const result = await ask(s.owner.client, seen);

        const names = (result.breaches as Array<{ task: string }>).map(
            (b) => b.task,
        );
        expect(names).toContain("Late complaint");
        expect(result.queue).toBe("/sla");
        const row = (result.breaches as Array<Record<string, unknown>>).find(
            (b) => b.task === "Late complaint",
        );
        expect(row?.hoursLate).toBe(3);
    });
});
