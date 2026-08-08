import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeTask, makeUser, makeWorkspace } from "../test-utils/factories";
import { dhakaDayOffset } from "../test-utils/dates";
import { getDb } from "../../src/db/client";
import { notifications, taskAssignees, tasks } from "../../src/db/schema";
import { Config } from "../../src/config";
import { MailService } from "../../src/services/MailService";

/**
 * Tests for `POST /api/v1/jobs/overdue-alert` (assignment/overdue email
 * feature, 2026-08-08 — upgrade 014).
 *
 * Private DB `tms_jobs_test`. 🤖 internal-token auth. The job alerts every
 * assignee of a task whose `due_date` passed on the workspace's calendar:
 * one in-app `overdue` notification per assignee + one email, then claims
 * `tasks.overdue_notified_at` so a re-run delivers nothing twice. The default
 * factory workspace timezone is Asia/Dhaka, so `dhakaDayOffset` builds the
 * due-date fixtures on exactly the calendar the job scans with.
 *
 * MailService is spied at the prototype (the established seam) — under
 * NODE_ENV=test the real transport is log-only anyway; the spy just makes the
 * calls observable and deterministic.
 */

const URL = "/api/v1/jobs/overdue-alert";
const token = (): string => Config.INTERNAL_JOB_TOKEN ?? "";

const post = async (qs = "") =>
    (await oneOff())
        .post(`${URL}${qs}`)
        .set("X-Internal-Token", token())
        .send({});

let mailSpy: jest.SpyInstance;

beforeEach(() => {
    mailSpy = jest
        .spyOn(MailService.prototype, "sendTaskOverdueEmail")
        .mockResolvedValue(undefined);
});

afterEach(() => {
    mailSpy.mockRestore();
});

/** A task with a due date `dueOffsetDays` from Dhaka-today + these assignees. */
const makeDueTask = async (input: {
    workspaceId: string;
    dueOffsetDays: number;
    assigneeIds?: string[];
    completedAt?: Date | null;
    archivedAt?: Date | null;
    name?: string;
}) => {
    const t = await makeTask({
        workspaceId: input.workspaceId,
        name: input.name,
        archivedAt: input.archivedAt ?? null,
    });
    const db = getDb();
    await db
        .update(tasks)
        .set({
            dueDate: dhakaDayOffset(input.dueOffsetDays),
            completedAt: input.completedAt ?? null,
        })
        .where(eq(tasks.id, t.id));
    for (const userId of input.assigneeIds ?? []) {
        await db.insert(taskAssignees).values({ taskId: t.id, userId });
    }
    return t;
};

const taskRow = async (taskId: string) =>
    (
        await getDb().select().from(tasks).where(eq(tasks.id, taskId))
    )[0];

const overdueNotifsFor = async (userId: string) =>
    getDb()
        .select()
        .from(notifications)
        .where(
            and(
                eq(notifications.userId, userId),
                eq(notifications.type, "overdue"),
            ),
        );

describe("POST /api/v1/jobs/overdue-alert", () => {
    describe("Happy path", () => {
        it("notifies + emails each assignee of a past-due task and claims the marker", async () => {
            const ws = await makeWorkspace();
            const a = await makeUser({ workspaceId: ws.id });
            const b = await makeUser({ workspaceId: ws.id });
            const t = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -1, // due yesterday, Dhaka calendar
                assigneeIds: [a.id, b.id],
                name: "Ship the campaign page",
            });

            const res = await post();

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.notified).toBe(1);
            expect(res.body.emailsSent).toBe(2);
            expect(res.body.emailErrors).toBe(0);

            // In-app rows: one per assignee, system-authored, titled.
            for (const u of [a, b]) {
                const rows = await overdueNotifsFor(u.id);
                expect(rows).toHaveLength(1);
                expect(rows[0].entityType).toBe("task");
                expect(rows[0].entityId).toBe(t.id);
                expect(rows[0].actorId).toBeNull();
                expect(rows[0].title).toBe("Overdue: Ship the campaign page");
            }

            // The once-only claim.
            expect((await taskRow(t.id)).overdueNotifiedAt).not.toBeNull();

            // Emails: one per assignee, carrying the task name + /t/ link.
            const recipients = mailSpy.mock.calls.map((c) => c[0] as string);
            expect(recipients.sort()).toEqual([a.email, b.email].sort());
            const payload = mailSpy.mock.calls[0][1] as {
                taskName: string;
                taskUrl: string;
                dueYmd: string;
            };
            expect(payload.taskName).toBe("Ship the campaign page");
            expect(payload.taskUrl).toContain(`/t/${t.id}`);
            expect(payload.dueYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it("delivers exactly once — a second run flips nothing", async () => {
            const ws = await makeWorkspace();
            const a = await makeUser({ workspaceId: ws.id });
            await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -2,
                assigneeIds: [a.id],
            });

            const first = await post();
            expect(first.body.notified).toBe(1);

            mailSpy.mockClear();
            const second = await post();
            expect(second.body.notified).toBe(0);
            expect(second.body.emailsSent).toBe(0);
            expect(mailSpy).not.toHaveBeenCalled();
            expect(await overdueNotifsFor(a.id)).toHaveLength(1);
        });

        it("re-alerts after the claim is re-armed (the due-date-change path)", async () => {
            const ws = await makeWorkspace();
            const a = await makeUser({ workspaceId: ws.id });
            const t = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -1,
                assigneeIds: [a.id],
            });
            await post();
            expect(await overdueNotifsFor(a.id)).toHaveLength(1);

            // TaskWriteService clears the marker whenever due_date changes;
            // simulate that re-arm (a new, also-passed deadline).
            await getDb()
                .update(tasks)
                .set({
                    overdueNotifiedAt: null,
                    dueDate: dhakaDayOffset(-1),
                })
                .where(eq(tasks.id, t.id));

            const res = await post();
            expect(res.body.notified).toBe(1);
            expect(await overdueNotifsFor(a.id)).toHaveLength(2);
        });
    });

    describe("Exclusions", () => {
        it("leaves not-yet-due, completed, and archived tasks alone", async () => {
            const ws = await makeWorkspace();
            const a = await makeUser({ workspaceId: ws.id });
            const dueToday = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: 0, // due TODAY — not overdue until tomorrow
                assigneeIds: [a.id],
            });
            const done = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -3,
                assigneeIds: [a.id],
                completedAt: new Date(),
            });
            const archived = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -3,
                assigneeIds: [a.id],
                archivedAt: new Date(),
            });

            const res = await post();

            expect(res.body.notified).toBe(0);
            expect(mailSpy).not.toHaveBeenCalled();
            expect(await overdueNotifsFor(a.id)).toHaveLength(0);
            for (const t of [dueToday, done, archived]) {
                expect((await taskRow(t.id)).overdueNotifiedAt).toBeNull();
            }
        });

        it("skips (and does NOT claim) an overdue task with no assignees, so a later assignee still gets alerted", async () => {
            const ws = await makeWorkspace();
            const t = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -1,
                assigneeIds: [],
            });

            const res = await post();
            expect(res.body.notified).toBe(0);
            expect((await taskRow(t.id)).overdueNotifiedAt).toBeNull();

            // Someone picks it up while it is already overdue…
            const late = await makeUser({ workspaceId: ws.id });
            await getDb()
                .insert(taskAssignees)
                .values({ taskId: t.id, userId: late.id });

            const rerun = await post();
            expect(rerun.body.notified).toBe(1);
            expect(await overdueNotifsFor(late.id)).toHaveLength(1);
        });

        it("emails only ACTIVE assignees", async () => {
            const ws = await makeWorkspace();
            const active = await makeUser({ workspaceId: ws.id });
            const gone = await makeUser({
                workspaceId: ws.id,
                status: "deactivated",
            });
            await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -1,
                assigneeIds: [active.id, gone.id],
            });

            const res = await post();
            expect(res.body.notified).toBe(1);
            expect(res.body.emailsSent).toBe(1);
            expect(mailSpy).toHaveBeenCalledTimes(1);
            expect(mailSpy.mock.calls[0][0]).toBe(active.email);
        });
    });

    describe("dry_run", () => {
        it("counts without writing or emailing", async () => {
            const ws = await makeWorkspace();
            const a = await makeUser({ workspaceId: ws.id });
            const t = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -1,
                assigneeIds: [a.id],
            });

            const res = await post("?dry_run=true");

            expect(res.status).toBe(200);
            expect(res.body.dry_run).toBe(true);
            expect(res.body.wouldNotify).toBe(1);
            expect(mailSpy).not.toHaveBeenCalled();
            expect((await taskRow(t.id)).overdueNotifiedAt).toBeNull();
            expect(await overdueNotifsFor(a.id)).toHaveLength(0);
        });
    });

    describe("Resilience", () => {
        it("a failing SMTP send is counted, never a job failure, and the claim stands", async () => {
            const ws = await makeWorkspace();
            const a = await makeUser({ workspaceId: ws.id });
            const t = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -1,
                assigneeIds: [a.id],
            });
            mailSpy.mockRejectedValueOnce(new Error("smtp down"));

            const res = await post();

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.notified).toBe(1);
            expect(res.body.emailsSent).toBe(0);
            expect(res.body.emailErrors).toBe(1);
            // The in-app notification is the source of truth — still delivered,
            // and the claim prevents an email retry storm on the next tick.
            expect(await overdueNotifsFor(a.id)).toHaveLength(1);
            expect((await taskRow(t.id)).overdueNotifiedAt).not.toBeNull();
        });
    });

    describe("Auth", () => {
        it("401 auth.unauthorized without the internal token, and the job does not run", async () => {
            const ws = await makeWorkspace();
            const a = await makeUser({ workspaceId: ws.id });
            const t = await makeDueTask({
                workspaceId: ws.id,
                dueOffsetDays: -1,
                assigneeIds: [a.id],
            });

            const res = await (await oneOff()).post(URL).send({});
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.unauthorized");
            expect((await taskRow(t.id)).overdueNotifiedAt).toBeNull();
        });
    });
});
