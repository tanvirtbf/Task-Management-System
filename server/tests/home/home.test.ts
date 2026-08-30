import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeList,
    makeStatus,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { taskAssignees, tasks } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";
import { utcDate } from "../test-utils/dates";

/**
 * Tests for §25 Home: `GET /api/v1/home/kpis` and `GET /api/v1/home/agenda`.
 *
 * KPIs come back in camelCase (per the curated checklist + frontend HomeKpiSet);
 * agenda comes back as a bare snake_case Task[]. Both 🔐 any member, all
 * workspace/user scoped.
 */

const KPIS = "/api/v1/home/kpis";
const AGENDA = "/api/v1/home/agenda";

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** DATE fixtures must be UTC midnight — see `test-utils/dates.ts` (F3). */
const toLocalDate = utcDate;
const todayStr = (): string => ymd(new Date());
const daysAgoStr = (n: number): string => ymd(new Date(Date.now() - n * DAY_MS));

type StatusGroup = "not_started" | "active" | "done" | "closed";

/** F24 (ISS-057): a KPI is a label and a number. `trend`/`trendDirection`/
 *  `isPositive` were hardcoded to 0/flat/false and rendered as a permanent
 *  "— 0.0%"; `sparkline` plotted `DATE(created_at)`, not the metric. */
interface HomeKpi {
    label: string;
    value: number;
    valueDisplay: string;
}
interface HomeKpiSet {
    myTasks: HomeKpi;
    dueToday: HomeKpi;
    overdue: HomeKpi;
    awaitingReview: HomeKpi;
    openTeamTasks: HomeKpi;
    slaBreaches: HomeKpi;
}

const fixture = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const actor = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(actor);
    const list = await makeList({ workspaceId: ws.id, createdBy: actor.id });
    return { ws, actor, client, list };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

interface SeedOpts {
    statusGroup?: StatusGroup;
    /** YYYY-MM-DD or null. */
    dueDate?: string | null;
    slaDueAt?: Date | null;
    completedAt?: Date | null;
    reviewerId?: string | null;
    /** F24 (ISS-059): the tile keys off this now, not `pr_status`. */
    reviewStatus?: "approved" | "flagged" | null;
    prStatus?: "open" | "merged" | "closed" | "draft" | null;
    /** user id to assign (inserts a task_assignees row). */
    assignTo?: string | null;
    archived?: boolean;
    /** override workspace/list (for isolation tests). */
    ws?: string;
    listId?: string;
}

/** Seed a task with full control over the KPI-relevant columns. */
const seedTask = async (f: Fixture, opts: SeedOpts = {}): Promise<string> => {
    const workspaceId = opts.ws ?? f.ws.id;
    const listId = opts.listId ?? f.list.id;
    const status = await makeStatus({
        scopeId: listId,
        statusGroup: opts.statusGroup ?? "active",
    });
    const t = await makeTask({
        workspaceId,
        listId,
        createdBy: f.actor.id,
        statusId: status.id,
        archivedAt: opts.archived ? new Date() : null,
    });

    const patch: Partial<typeof tasks.$inferInsert> = {};
    if (opts.dueDate !== undefined) {
        patch.dueDate = opts.dueDate === null ? null : toLocalDate(opts.dueDate);
    }
    if (opts.slaDueAt !== undefined) patch.slaDueAt = opts.slaDueAt;
    if (opts.completedAt !== undefined) patch.completedAt = opts.completedAt;
    if (opts.reviewerId !== undefined) patch.reviewerId = opts.reviewerId;
    if (opts.reviewStatus !== undefined) patch.reviewStatus = opts.reviewStatus;
    if (opts.prStatus !== undefined) patch.prStatus = opts.prStatus;
    if (Object.keys(patch).length > 0) {
        await getDb().update(tasks).set(patch).where(eq(tasks.id, t.id));
    }
    if (opts.assignTo) {
        await getDb()
            .insert(taskAssignees)
            .values({ taskId: t.id, userId: opts.assignTo });
    }
    return t.id;
};

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

const _sum = (a: number[]): number => a.reduce((s, n) => s + n, 0);

describe("GET /api/v1/home/kpis", () => {
    // ─── Shape ────────────────────────────────────────────────────────────────
    describe("Shape", () => {
        it("returns all six camelCase tiles with the full HomeKpi shape", async () => {
            const { client } = await fixture();
            const res = await client.get(KPIS);

            expect(res.status).toBe(200);
            const body = res.body as HomeKpiSet;
            expect(Object.keys(body).sort()).toEqual([
                "awaitingReview",
                "dueToday",
                "myTasks",
                "openTeamTasks",
                "overdue",
                "slaBreaches",
            ]);
            for (const key of Object.keys(body) as (keyof HomeKpiSet)[]) {
                const tile = body[key];
                // F24 (ISS-057): three keys, and none of them invented.
                expect(Object.keys(tile).sort()).toEqual([
                    "label",
                    "value",
                    "valueDisplay",
                ]);
                expect(tile.valueDisplay).toBe(String(tile.value));
            }
            expect(body.myTasks.label).toBe("My Open Tasks");
            expect(body.slaBreaches.label).toBe("SLA Breaches");
        });

        it("returns all-zero tiles for an empty workspace", async () => {
            const { client } = await fixture();
            const body = (await client.get(KPIS)).body as HomeKpiSet;
            for (const key of Object.keys(body) as (keyof HomeKpiSet)[]) {
                expect(body[key].value).toBe(0);
            }
        });
    });

    // ─── myTasks ────────────────────────────────────────────────────────────
    describe("myTasks", () => {
        it("counts my open, non-archived tasks only", async () => {
            const f = await fixture();
            await seedTask(f, { assignTo: f.actor.id, statusGroup: "active" });
            await seedTask(f, { assignTo: f.actor.id, statusGroup: "not_started" });
            await seedTask(f, { statusGroup: "active" }); // unassigned → not mine
            await seedTask(f, { assignTo: f.actor.id, statusGroup: "done" }); // closed group
            await seedTask(f, {
                assignTo: f.actor.id,
                statusGroup: "active",
                archived: true,
            });

            const body = (await f.client.get(KPIS)).body as HomeKpiSet;
            expect(body.myTasks.value).toBe(2);
        });
    });

    // ─── dueToday / overdue ───────────────────────────────────────────────────
    describe("dueToday & overdue", () => {
        it("splits my open tasks by due date", async () => {
            const f = await fixture();
            await seedTask(f, { assignTo: f.actor.id, dueDate: todayStr() });
            await seedTask(f, { assignTo: f.actor.id, dueDate: daysAgoStr(1) });
            await seedTask(f, { assignTo: f.actor.id, dueDate: daysAgoStr(3) });
            await seedTask(f, { assignTo: f.actor.id, dueDate: null }); // no due date

            const body = (await f.client.get(KPIS)).body as HomeKpiSet;
            expect(body.dueToday.value).toBe(1);
            expect(body.overdue.value).toBe(2);
        });

        it("does not count a done task as overdue", async () => {
            const f = await fixture();
            await seedTask(f, {
                assignTo: f.actor.id,
                dueDate: daysAgoStr(2),
                statusGroup: "done",
            });
            const body = (await f.client.get(KPIS)).body as HomeKpiSet;
            expect(body.overdue.value).toBe(0);
        });
    });

    // ─── awaitingReview ───────────────────────────────────────────────────────
    describe("awaitingReview", () => {
        it("counts COMPLETED, unreviewed tasks waiting on me (F24/ISS-059)", async () => {
            // This spec used to assert `pr_status='open'` — the GitHub
            // pull-request field, NULL on every task in the live database, so
            // the tile read 0 for everyone forever while the dept-head review
            // queue had real work. The metric now counts what a head would
            // expect: completed + not yet reviewed + waiting on ME.
            const f = await fixture();
            const other = await makeUser({ workspaceId: f.ws.id });
            await seedTask(f, {
                reviewerId: f.actor.id,
                statusGroup: "done",
            }); // mine, completed, unreviewed → counts
            await seedTask(f, {
                reviewerId: f.actor.id,
                statusGroup: "active",
            }); // not completed yet
            await seedTask(f, {
                reviewerId: f.actor.id,
                statusGroup: "done",
                reviewStatus: "approved",
            }); // already reviewed
            await seedTask(f, { reviewerId: other.id, statusGroup: "done" }); // not me
            await seedTask(f, {
                reviewerId: f.actor.id,
                statusGroup: "done",
                archived: true,
            }); // archived

            const body = (await f.client.get(KPIS)).body as HomeKpiSet;
            expect(body.awaitingReview.value).toBe(1);
        });
    });

    // ─── openTeamTasks ────────────────────────────────────────────────────────
    describe("openTeamTasks", () => {
        it("counts every open workspace task regardless of assignee", async () => {
            const f = await fixture();
            await seedTask(f, { assignTo: f.actor.id, statusGroup: "active" });
            await seedTask(f, { statusGroup: "not_started" }); // unassigned, still open
            await seedTask(f, { statusGroup: "closed" }); // not open
            await seedTask(f, { statusGroup: "active", archived: true }); // archived

            const body = (await f.client.get(KPIS)).body as HomeKpiSet;
            expect(body.openTeamTasks.value).toBe(2);
        });
    });

    // ─── slaBreaches ──────────────────────────────────────────────────────────
    describe("slaBreaches", () => {
        it("counts past-SLA, uncompleted, non-archived tasks", async () => {
            const f = await fixture();
            const past = new Date(Date.now() - 60_000);
            const future = new Date(Date.now() + 60 * 60_000);
            await seedTask(f, { slaDueAt: past });
            await seedTask(f, { slaDueAt: future }); // not breached yet
            await seedTask(f, { slaDueAt: past, completedAt: new Date() }); // completed
            await seedTask(f, { slaDueAt: past, archived: true }); // archived

            const body = (await f.client.get(KPIS)).body as HomeKpiSet;
            expect(body.slaBreaches.value).toBe(1);
        });
    });

    // ─── Workspace isolation ──────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("never counts another workspace's tasks", async () => {
            const f = await fixture();
            const other = await fixture();
            await seedTask(other, {
                assignTo: other.actor.id,
                statusGroup: "active",
            });
            await seedTask(other, { statusGroup: "active" });

            const body = (await f.client.get(KPIS)).body as HomeKpiSet;
            expect(body.myTasks.value).toBe(0);
            expect(body.openTeamTasks.value).toBe(0);
        });
    });

    // ─── Auth / authz ─────────────────────────────────────────────────────────
    describe("Authentication & authorization", () => {
        it("401 without a token", async () => {
            const http = await oneOff();
            const res = await http.get(KPIS);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const u = await makeUser();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(KPIS)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
        });

        for (const role of ["owner", "admin", "member", "guest"] as Role[]) {
            it(`allows a ${role} (200)`, async () => {
                const f = await fixture(role);
                const res = await f.client.get(KPIS);
                expect(res.status).toBe(200);
            });
        }
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client } = await fixture();
            const res = await client.get(KPIS);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});

describe("GET /api/v1/home/agenda", () => {
    interface WireTask {
        id: string;
        name: string;
        due_date: string | null;
        status_id: string;
        assignees: string[];
        workspace_id: string;
    }

    describe("Happy path", () => {
        it("returns my open tasks due today (default date) as a bare Task[]", async () => {
            const f = await fixture();
            const t1 = await seedTask(f, {
                assignTo: f.actor.id,
                dueDate: todayStr(),
            });
            await seedTask(f, { assignTo: f.actor.id, dueDate: daysAgoStr(1) }); // not today
            await seedTask(f, { dueDate: todayStr() }); // not mine
            await seedTask(f, {
                assignTo: f.actor.id,
                dueDate: todayStr(),
                statusGroup: "done",
            }); // done

            const res = await f.client.get(AGENDA);
            expect(res.status).toBe(200);
            const body = res.body as WireTask[];
            expect(Array.isArray(body)).toBe(true);
            expect(body).toHaveLength(1);
            expect(body[0].id).toBe(t1);
            expect(body[0].due_date).toBe(todayStr());
            expect(body[0].assignees).toContain(f.actor.id);
            expect(body[0].workspace_id).toBe(f.ws.id);
        });

        it("honours an explicit ?date=", async () => {
            const f = await fixture();
            const target = daysAgoStr(2);
            await seedTask(f, { assignTo: f.actor.id, dueDate: target });
            await seedTask(f, { assignTo: f.actor.id, dueDate: todayStr() });

            const body = (await f.client.get(`${AGENDA}?date=${target}`))
                .body as WireTask[];
            expect(body).toHaveLength(1);
            expect(body[0].due_date).toBe(target);
        });

        it("returns an empty array when nothing is due", async () => {
            const f = await fixture();
            const res = await f.client.get(AGENDA);
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });
    });

    describe("Validation", () => {
        it("422 for a non-date ?date=", async () => {
            const { client } = await fixture();
            const res = await client.get(`${AGENDA}?date=notadate`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 for an impossible calendar date", async () => {
            const { client } = await fixture();
            const res = await client.get(`${AGENDA}?date=2026-13-40`);
            expect(res.status).toBe(422);
        });
    });

    describe("Workspace isolation", () => {
        it("never returns another workspace's tasks", async () => {
            const f = await fixture();
            const other = await fixture();
            await seedTask(other, {
                assignTo: other.actor.id,
                dueDate: todayStr(),
            });
            const res = await f.client.get(AGENDA);
            expect(res.body).toEqual([]);
        });
    });

    describe("Authentication", () => {
        it("401 without a token", async () => {
            const http = await oneOff();
            const res = await http.get(AGENDA);
            expect(res.status).toBe(401);
        });
    });
});
