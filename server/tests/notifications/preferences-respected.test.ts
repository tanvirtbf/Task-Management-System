import { and, eq } from "drizzle-orm";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import { BASE } from "./_helpers";

/**
 * Do the PRODUCERS actually honour `PUT /notifications/preferences`?
 *
 * `preferences.test.ts` covers the setting itself — that it stores, reads back,
 * validates and stays per-user. Nothing covered the half that matters to the
 * person using it: that turning a type off stops the notification arriving. A
 * preferences screen whose value nothing reads is a switch wired to nothing,
 * and it would pass every existing test.
 *
 * The suppression lives in ONE place — `NotificationsRepo.createMany` drops
 * rows whose recipient disabled that type — so every producer inherits it. That
 * is the design worth pinning: these tests drive a REAL producer
 * (`POST /tasks/:id/assignees`) rather than inserting rows, because inserting
 * rows bypasses the very filter under test.
 */

jest.setTimeout(30_000);

const assigneesPath = (taskId: string) => `/api/v1/tasks/${taskId}/assignees`;

const notifsOf = async (userId: string, type?: string) => {
    const where = type
        ? and(
              eq(notifications.userId, userId),
              eq(
                  notifications.type,
                  type as (typeof notifications.type.enumValues)[number],
              ),
          )
        : eq(notifications.userId, userId);
    return getDb().select().from(notifications).where(where);
};

/** An assigner with a client, a task, and two people who can be assigned. */
const scene = async () => {
    const ws = await makeWorkspace();
    const assigner = await makeUser({ workspaceId: ws.id, role: "admin" });
    const rahim = await makeUser({ workspaceId: ws.id });
    const karim = await makeUser({ workspaceId: ws.id });
    const client = await makeLoggedInClient(assigner);
    const rahimClient = await makeLoggedInClient(rahim);
    const karimClient = await makeLoggedInClient(karim);
    const task = await makeTask({ workspaceId: ws.id, createdBy: assigner.id });
    return {
        ws,
        assigner,
        rahim,
        karim,
        client,
        rahimClient,
        karimClient,
        task,
    };
};

type Client = Awaited<ReturnType<typeof makeLoggedInClient>>;

/**
 * Set one notification type on/off, through the real endpoint, as that person.
 *
 * Takes a CLIENT, not a user: logging the same person in twice inside one test
 * mints the same token in the same second and collides on
 * `sessions.uq_sessions_token_hash`.
 */
const setPref = async (own: Client, type: string, inAppEnabled: boolean) => {
    const res = await own
        .put(`${BASE}/preferences`)
        .send({ [type]: { in_app_enabled: inAppEnabled } });
    // The fixture asserts its own status: a silently-422ing setup would leave
    // every assertion below comparing "no notification" against "no
    // notification" and passing for the wrong reason.
    expect(res.status).toBe(200);
    expect(res.body[type]).toEqual({ in_app_enabled: inAppEnabled });
};

const disable = (own: Client, type: string) => setPref(own, type, false);
const enable = (own: Client, type: string) => setPref(own, type, true);

describe("Notification preferences are honoured by the producers", () => {
    it("delivers `assigned` by default — the control", async () => {
        const s = await scene();

        const res = await s.client
            .post(assigneesPath(s.task.id))
            .send({ user_ids: [s.rahim.id] });

        expect(res.status).toBe(204);
        expect(await notifsOf(s.rahim.id, "assigned")).toHaveLength(1);
    });

    it("creates NO row for someone who turned `assigned` off", async () => {
        const s = await scene();
        await disable(s.rahimClient, "assigned");

        const res = await s.client
            .post(assigneesPath(s.task.id))
            .send({ user_ids: [s.rahim.id] });

        // The assignment itself still happens — a preference silences the
        // notification, it does not veto the work.
        expect(res.status).toBe(204);
        expect(await notifsOf(s.rahim.id)).toHaveLength(0);
    });

    it("suppresses only the person who opted out, in the same call", async () => {
        const s = await scene();
        await disable(s.rahimClient, "assigned");

        await s.client
            .post(assigneesPath(s.task.id))
            .send({ user_ids: [s.rahim.id, s.karim.id] });

        expect(await notifsOf(s.rahim.id)).toHaveLength(0);
        expect(await notifsOf(s.karim.id, "assigned")).toHaveLength(1);
    });

    it("suppresses only the type that was turned off", async () => {
        const s = await scene();
        await disable(s.rahimClient, "mentioned");

        await s.client
            .post(assigneesPath(s.task.id))
            .send({ user_ids: [s.rahim.id] });

        // `mentioned` is off; `assigned` was never touched.
        expect(await notifsOf(s.rahim.id, "assigned")).toHaveLength(1);
    });

    it("resumes delivery when the preference is turned back on", async () => {
        const s = await scene();
        await disable(s.rahimClient, "assigned");
        await s.client
            .post(assigneesPath(s.task.id))
            .send({ user_ids: [s.rahim.id] });
        expect(await notifsOf(s.rahim.id)).toHaveLength(0);

        await enable(s.rahimClient, "assigned");
        // Re-assign: remove then add, so the producer runs again.
        await s.client.delete(`${assigneesPath(s.task.id)}/${s.rahim.id}`);
        await s.client
            .post(assigneesPath(s.task.id))
            .send({ user_ids: [s.rahim.id] });

        expect(await notifsOf(s.rahim.id, "assigned")).toHaveLength(1);
    });

    it("a preference set by one person does not silence anybody else", async () => {
        const s = await scene();
        await disable(s.karimClient, "assigned");

        await s.client
            .post(assigneesPath(s.task.id))
            .send({ user_ids: [s.rahim.id] });

        expect(await notifsOf(s.rahim.id, "assigned")).toHaveLength(1);
    });
});
