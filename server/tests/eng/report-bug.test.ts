import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { taskActivity, notifications, lists, spaces } from "../../src/db/schema";
import {
    makeUser,
    makeLoggedInClient,
    makeTaskType,
    makeSpace,
    makeList,
    makeStatus,
    makeOnCallShift,
} from "../test-utils/factories";
import { oneOff, type LoggedInClient } from "../test-utils/app";
import type { Role } from "../../src/constants";

/**
 * §22 #1 — POST /api/v1/eng/report-bug
 *
 * Cross-team bug intake: composes a Bug task in the workspace's "Bug Triage"
 * list (resolved by name), applies the §29 per-severity SLA, and auto-assigns
 * the current on-call engineer for S0/S1. 🔐 any authenticated member.
 */

const ENDPOINT = "/api/v1/eng/report-bug";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * F28 (ISS-029, decision D12.2): SLA durations are counted on the BUSINESS
 * clock now, so these specs assert the property the fix delivers — the deadline
 * lands inside a working window, in the future, within a sane bound — instead
 * of `now + offset`, whose truth depended on which day the suite ran. The
 * workspace factory seeds the schema defaults: sun–thu, 09:00–18:00,
 * Asia/Dhaka. Longer rationale: tests/tasks/create.test.ts.
 */
const expectBusinessDeadline = (iso: string | null, maxDaysAhead: number) => {
    expect(iso).not.toBeNull();
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dhaka",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(new Date(iso as string));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const minutes = Number(get("hour")) * 60 + Number(get("minute"));
    expect(["sun", "mon", "tue", "wed", "thu"]).toContain(
        get("weekday").toLowerCase(),
    );
    expect(minutes).toBeGreaterThanOrEqual(9 * 60);
    expect(minutes).toBeLessThanOrEqual(18 * 60);
    const ahead = (new Date(iso as string).getTime() - Date.now()) / DAY;
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThan(maxDaysAhead);
};

interface EngWorkspace {
    workspaceId: string;
    ownerId: string;
    bugTypeId: string;
    bugListId: string;
    spaceId: string;
    statusId: string;
    client: LoggedInClient;
}

/**
 * Give the Bug Triage space a head. Done after the fact rather than through
 * `makeSpace({ headUserId })` because the head has to be a user IN this
 * workspace, and the workspace does not exist until the helper below has run.
 */
const setSpaceHead = async (spaceId: string, userId: string) => {
    await getDb()
        .update(spaces)
        .set({ headUserId: userId })
        .where(eq(spaces.id, spaceId));
};

/** A workspace wired for §22: a "Bug" task type + a "Bug Triage" list + status. */
const makeEngWorkspace = async (
    opts: { role?: Role } = {},
): Promise<EngWorkspace> => {
    const owner = await makeUser({ role: opts.role ?? "member" });
    const workspaceId = owner.workspaceId;
    const bugType = await makeTaskType({ workspaceId, name: "Bug" });
    const space = await makeSpace({ workspaceId, createdBy: owner.id });
    const bugList = await makeList({
        workspaceId,
        spaceId: space.id,
        createdBy: owner.id,
        name: "Bug Triage",
    });
    const status = await makeStatus({
        scopeId: bugList.id,
        statusGroup: "not_started",
        name: "Reported",
    });
    const client = await makeLoggedInClient({
        id: owner.id,
        workspaceId,
        role: owner.role,
    });
    return {
        workspaceId,
        ownerId: owner.id,
        bugTypeId: bugType.id,
        bugListId: bugList.id,
        spaceId: space.id,
        statusId: status.id,
        client,
    };
};

const validBody = (over: Record<string, unknown> = {}) => ({
    steps: "1. Open the product page\n2. Click add-to-cart",
    happened: "Cart counter stays at 0",
    expected: "Counter increments to 1",
    reporter_team: "cs",
    ...over,
});

describe("POST /api/v1/eng/report-bug", () => {
    describe("Happy path", () => {
        it("creates a Bug task in the Bug Triage list and returns 201 + the hydrated Task", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client.post(ENDPOINT).send(validBody());

            expect(res.status).toBe(201);
            expect(typeof res.body.id).toBe("string");
            expect(res.body.task_type_id).toBe(eng.bugTypeId);
            expect(res.body.primary_list_id).toBe(eng.bugListId);
            expect(res.body.status_id).toBe(eng.statusId);
            expect(res.body.reporter_team).toBe("cs");
            expect(res.body.archived_at).toBeNull();
        });

        it("defaults severity to S2 (7-working-day SLA) when omitted", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client.post(ENDPOINT).send(validBody());

            expect(res.status).toBe(201);
            expect(res.body.bug_severity).toBe("S2");
            // 7 working days over a 5-day week is at most ~11 calendar days.
            expectBusinessDeadline(res.body.sla_due_at, 12);
        });

        it("derives the task name from `happened` and folds the intake into the description", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client.post(ENDPOINT).send(validBody());

            expect(res.body.name).toBe("Cart counter stays at 0");
            expect(res.body.description).toContain("Steps to reproduce");
            expect(res.body.description).toContain("1. Open the product page");
            expect(res.body.description).toContain("What happened");
            expect(res.body.description).toContain("Cart counter stays at 0");
            expect(res.body.description).toContain("Expected");
            expect(res.body.description).toContain("team: cs");
        });

        it("includes url + screenshots in the description when provided", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client.post(ENDPOINT).send(
                validBody({
                    url: "https://shop.example.com/p/nic-30",
                    screenshots: ["att-1", "att-2"],
                }),
            );

            expect(res.status).toBe(201);
            expect(res.body.description).toContain(
                "https://shop.example.com/p/nic-30",
            );
            expect(res.body.description).toContain("att-1, att-2");
        });

        it("omits the optional url/expected/screenshots lines when not provided", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client
                .post(ENDPOINT)
                .send({ steps: "s", happened: "h", reporter_team: "ops" });

            expect(res.status).toBe(201);
            expect(res.body.description).not.toContain("Expected");
            expect(res.body.description).not.toContain("URL:");
            expect(res.body.description).not.toContain("Screenshots:");
        });
    });

    describe("Severity → SLA (§29, business clock since F28)", () => {
        it("S0 → 2 working hours, inside the business window", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S0" }));

            expect(res.body.bug_severity).toBe("S0");
            // Worst case: filed Thursday at close → Sunday morning (~2.7 days).
            expectBusinessDeadline(res.body.sla_due_at, 4);
        });

        it("S1 → 1 working day, inside the business window", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S1" }));

            expect(res.body.bug_severity).toBe("S1");
            expectBusinessDeadline(res.body.sla_due_at, 5);
        });

        it("S2 → 7 working days, inside the business window", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S2" }));

            expect(res.body.bug_severity).toBe("S2");
            expectBusinessDeadline(res.body.sla_due_at, 12);
        });

        it("S3 → sla_due_at is null", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S3" }));

            expect(res.body.bug_severity).toBe("S3");
            expect(res.body.sla_due_at).toBeNull();
        });
    });

    /**
     * Routing. These specs used to assert that a report was assigned ONLY when
     * it was an S0/S1 and somebody was on call — which is exactly the bug a CS
     * agent hit: an S2 landed in Bug Triage owned by nobody and notified
     * nobody, and once the rota lapsed a site-down S0 did the same. Assignment
     * is what sends the in-app notification and the email, so a report assigned
     * to nobody has not reached the software team at all.
     *
     * The contract now: the pager takes S0/S1, the Engineering space head takes
     * everything else AND anything the pager missed.
     */
    describe("Routing — a report reaches a person", () => {
        it("assigns the current on-call engineer for S0", async () => {
            const eng = await makeEngWorkspace();
            const shift = await makeOnCallShift({
                workspaceId: eng.workspaceId,
            });
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S0" }));

            expect(res.status).toBe(201);
            expect(res.body.assignees).toEqual([shift.engineerId]);
        });

        it("assigns the current on-call engineer for S1", async () => {
            const eng = await makeEngWorkspace();
            const shift = await makeOnCallShift({
                workspaceId: eng.workspaceId,
            });
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S1" }));

            expect(res.body.assignees).toEqual([shift.engineerId]);
        });

        it("does not page for S2 — the space head owns it instead", async () => {
            const eng = await makeEngWorkspace();
            const head = await makeUser({ workspaceId: eng.workspaceId });
            await setSpaceHead(eng.spaceId, head.id);
            const shift = await makeOnCallShift({
                workspaceId: eng.workspaceId,
            });
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S2" }));

            expect(res.status).toBe(201);
            // nobody is woken up for an S2 …
            expect(res.body.assignees).not.toContain(shift.engineerId);
            // … but the report is still somebody's job.
            expect(res.body.assignees).toEqual([head.id]);
        });

        /**
         * The production failure, verbatim: the last on-call shift ended on a
         * Friday, nobody filled the next week, and every report after that —
         * a site-down S0 included — was filed to nobody.
         */
        it("routes an S0 to the space head when the rota has lapsed", async () => {
            const eng = await makeEngWorkspace();
            const head = await makeUser({ workspaceId: eng.workspaceId });
            await setSpaceHead(eng.spaceId, head.id);
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S0" }));

            expect(res.status).toBe(201);
            expect(res.body.assignees).toEqual([head.id]);
        });

        it("prefers the on-call engineer over the head for a page", async () => {
            const eng = await makeEngWorkspace();
            const head = await makeUser({ workspaceId: eng.workspaceId });
            await setSpaceHead(eng.spaceId, head.id);
            const shift = await makeOnCallShift({
                workspaceId: eng.workspaceId,
            });
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S1" }));

            expect(res.body.assignees).toEqual([shift.engineerId]);
        });

        it("does NOT assign a DEACTIVATED head (and does not 422)", async () => {
            const eng = await makeEngWorkspace();
            const goneHead = await makeUser({
                workspaceId: eng.workspaceId,
                status: "deactivated",
            });
            await setSpaceHead(eng.spaceId, goneHead.id);
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S2" }));

            expect(res.status).toBe(201);
            expect(res.body.assignees).toHaveLength(0);
        });

        /**
         * The one case that still reaches nobody: no on-call engineer and no
         * active head. Filing it anyway beats losing it, and the service logs
         * `eng.report_bug.unrouted` so the silence is visible.
         */
        it("still files the report when there is neither an on-call nor a head", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S0" }));

            expect(res.status).toBe(201);
            expect(res.body.assignees).toHaveLength(0);
        });

        // No head in the two workspaces below, so a failed pager lookup leaves
        // the report with nobody — the fallback's absence, not its refusal.
        it("does NOT assign a DEACTIVATED on-call engineer (and does not 422)", async () => {
            const eng = await makeEngWorkspace();
            const deactivated = await makeUser({
                workspaceId: eng.workspaceId,
                status: "deactivated",
            });
            await makeOnCallShift({
                workspaceId: eng.workspaceId,
                engineerId: deactivated.id,
                createdBy: eng.ownerId,
            });
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S0" }));

            expect(res.status).toBe(201);
            expect(res.body.assignees).toHaveLength(0);
        });

        it("does NOT assign when the on-call shift is not the current week", async () => {
            const eng = await makeEngWorkspace();
            const engineer = await makeUser({ workspaceId: eng.workspaceId });
            const threeWeeksAgo = new Date();
            threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
            await makeOnCallShift({
                workspaceId: eng.workspaceId,
                engineerId: engineer.id,
                weekStart: threeWeeksAgo,
            });
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S0" }));

            expect(res.status).toBe(201);
            expect(res.body.assignees).toHaveLength(0);
        });

        it("fires an `assigned` notification to the on-call engineer", async () => {
            const eng = await makeEngWorkspace();
            const shift = await makeOnCallShift({
                workspaceId: eng.workspaceId,
            });
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S0" }));

            const db = getDb();
            const rows = await db
                .select()
                .from(notifications)
                .where(
                    and(
                        eq(notifications.userId, shift.engineerId),
                        eq(notifications.entityId, res.body.id),
                    ),
                );
            expect(rows).toHaveLength(1);
            expect(rows[0].type).toBe("assigned");
        });

        it("writes task_created + assignee_added activity rows", async () => {
            const eng = await makeEngWorkspace();
            await makeOnCallShift({ workspaceId: eng.workspaceId });
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ severity: "S1" }));

            const db = getDb();
            const rows = await db
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, res.body.id));
            const actions = rows.map((r) => r.action);
            expect(actions).toContain("task_created");
            expect(actions).toContain("assignee_added");
        });
    });

    describe("Validation (422)", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["missing steps", { happened: "h", reporter_team: "cs" }],
            ["missing happened", { steps: "s", reporter_team: "cs" }],
            ["missing reporter_team", { steps: "s", happened: "h" }],
            [
                "invalid reporter_team",
                { steps: "s", happened: "h", reporter_team: "engineering" },
            ],
            [
                "invalid severity",
                {
                    steps: "s",
                    happened: "h",
                    reporter_team: "cs",
                    severity: "S9",
                },
            ],
            [
                "whitespace-only steps",
                { steps: "   ", happened: "h", reporter_team: "cs" },
            ],
            [
                "non-array screenshots",
                {
                    steps: "s",
                    happened: "h",
                    reporter_team: "cs",
                    screenshots: "att-1",
                },
            ],
            [
                "non-string screenshot element",
                {
                    steps: "s",
                    happened: "h",
                    reporter_team: "cs",
                    screenshots: [123],
                },
            ],
        ];

        it.each(cases)("422 — %s", async (_label, body) => {
            const eng = await makeEngWorkspace();
            const res = await eng.client.post(ENDPOINT).send(body);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 — steps longer than the max", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client
                .post(ENDPOINT)
                .send(validBody({ steps: "a".repeat(5001) }));
            expect(res.status).toBe(422);
        });
    });

    describe("Auth", () => {
        it("401 without a token", async () => {
            const res = await (await oneOff()).post(ENDPOINT).send(validBody());
            expect(res.status).toBe(401);
        });
    });

    describe("Not configured (409 eng.not_configured)", () => {
        it("409 when the workspace has no Bug task type", async () => {
            const owner = await makeUser({ role: "member" });
            const space = await makeSpace({
                workspaceId: owner.workspaceId,
                createdBy: owner.id,
            });
            const bugList = await makeList({
                workspaceId: owner.workspaceId,
                spaceId: space.id,
                createdBy: owner.id,
                name: "Bug Triage",
            });
            await makeStatus({ scopeId: bugList.id });
            const client = await makeLoggedInClient({
                id: owner.id,
                workspaceId: owner.workspaceId,
                role: owner.role,
            });

            const res = await client.post(ENDPOINT).send(validBody());
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("eng.not_configured");
        });

        it("409 when the workspace has no Bug Triage list", async () => {
            const owner = await makeUser({ role: "member" });
            await makeTaskType({ workspaceId: owner.workspaceId, name: "Bug" });
            const client = await makeLoggedInClient({
                id: owner.id,
                workspaceId: owner.workspaceId,
                role: owner.role,
            });

            const res = await client.post(ENDPOINT).send(validBody());
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("eng.not_configured");
        });

        it("409 when the only Bug Triage list is archived", async () => {
            const eng = await makeEngWorkspace();
            const db = getDb();
            await db
                .update(lists)
                .set({ archivedAt: new Date() })
                .where(eq(lists.id, eng.bugListId));

            const res = await eng.client.post(ENDPOINT).send(validBody());
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("eng.not_configured");
        });
    });

    describe("Workspace isolation", () => {
        it("409 for a workspace lacking config even when another workspace has it", async () => {
            await makeEngWorkspace(); // workspace A — fully configured
            const bUser = await makeUser({ role: "member" }); // workspace B — none
            const bClient = await makeLoggedInClient({
                id: bUser.id,
                workspaceId: bUser.workspaceId,
                role: bUser.role,
            });

            const res = await bClient.post(ENDPOINT).send(validBody());
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("eng.not_configured");
        });

        it("creates the bug in the caller's OWN Bug Triage list", async () => {
            await makeEngWorkspace(); // A
            const b = await makeEngWorkspace(); // B
            const res = await b.client.post(ENDPOINT).send(validBody());

            expect(res.status).toBe(201);
            expect(res.body.primary_list_id).toBe(b.bugListId);
            expect(res.body.task_type_id).toBe(b.bugTypeId);
        });
    });

    describe("Boundary / unicode", () => {
        it("preserves Bangla unicode in name + description", async () => {
            const eng = await makeEngWorkspace();
            const res = await eng.client.post(ENDPOINT).send(
                validBody({
                    happened: "কার্ট কাউন্টার ০ থেকে বাড়ছে না",
                    steps: "১. পেজ খুলুন",
                }),
            );

            expect(res.status).toBe(201);
            expect(res.body.name).toBe("কার্ট কাউন্টার ০ থেকে বাড়ছে না");
            expect(res.body.description).toContain("১. পেজ খুলুন");
        });

        it.each(["ops", "cs", "inventory", "listing", "marketing", "internal"])(
            "accepts reporter_team=%s",
            async (team) => {
                const eng = await makeEngWorkspace();
                const res = await eng.client
                    .post(ENDPOINT)
                    .send(validBody({ reporter_team: team }));
                expect(res.status).toBe(201);
                expect(res.body.reporter_team).toBe(team);
            },
        );
    });

    describe("Authorization", () => {
        /**
         * F28 (ISS-094, D12.1): this spec is now the regression guard for the
         * bug-intake principal. D12.1 revoked `task.create` from the seeded
         * Guest role, and since the mechanism behind this endpoint is a task
         * insert, a guest's `bug.report` grant briefly opened no door — the
         * route admitted the request and `TaskWriteService.create` 403'd it.
         * `reportBug` now runs its insert under the named intake principal
         * (rbac/principals.ts §2b), so a guest CAN still do the one write the
         * role description promises: report a bug.
         */
        it("allows any authenticated member (incl. guest) to report — bug.report is the gate", async () => {
            const eng = await makeEngWorkspace({ role: "guest" });
            const res = await eng.client.post(ENDPOINT).send(validBody());
            expect(res.status).toBe(201);
        });

        it("attributes a guest's bug to the GUEST, not the intake principal", async () => {
            const eng = await makeEngWorkspace({ role: "guest" });
            const res = await eng.client.post(ENDPOINT).send(validBody());
            expect(res.status).toBe(201);
            expect(res.body.created_by).toBe(eng.ownerId);
        });
    });
});
