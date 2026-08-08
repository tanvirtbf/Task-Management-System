import { makeLoggedInClient, makeTask, makeUser, makeWorkspace } from "../test-utils/factories";
import { MailService } from "../../src/services/MailService";

/**
 * Assignment EMAIL delivery for `POST /api/v1/tasks/:id/assignees`
 * (assignment/overdue email feature, 2026-08-08).
 *
 * The email fan-out mirrors the in-app `assigned` notification exactly: every
 * NEWLY-added assignee except the actor gets one mail, re-adds are no-ops, and
 * delivery is fire-and-forget AFTER the transaction commits — so these tests
 * poll the prototype spy briefly instead of asserting synchronously.
 */

const waitForCalls = async (
    spy: jest.SpyInstance,
    times: number,
): Promise<void> => {
    for (let i = 0; i < 40; i += 1) {
        if (spy.mock.calls.length >= times) return;
        await new Promise((r) => setTimeout(r, 25));
    }
};

/** Settle window for asserting a call did NOT happen. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 200));

let mailSpy: jest.SpyInstance;

beforeEach(() => {
    mailSpy = jest
        .spyOn(MailService.prototype, "sendTaskAssignedEmail")
        .mockResolvedValue(undefined);
});

afterEach(() => {
    mailSpy.mockRestore();
});

describe("POST /api/v1/tasks/:id/assignees — email side effect", () => {
    it("emails the newly-assigned user (name, assigner, /t/ link)", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({
            workspaceId: ws.id,
            role: "admin",
            firstName: "Farhana",
            lastName: "Akter",
        });
        const assignee = await makeUser({ workspaceId: ws.id });
        const t = await makeTask({
            workspaceId: ws.id,
            createdBy: actor.id,
            name: "Restock serum inventory",
        });
        const client = await makeLoggedInClient(actor);

        const res = await client
            .post(`/api/v1/tasks/${t.id}/assignees`)
            .send({ user_ids: [assignee.id] });
        expect(res.status).toBe(204);

        await waitForCalls(mailSpy, 1);
        expect(mailSpy).toHaveBeenCalledTimes(1);
        expect(mailSpy.mock.calls[0][0]).toBe(assignee.email);
        const payload = mailSpy.mock.calls[0][1] as {
            taskName: string;
            taskUrl: string;
            assignerName: string;
        };
        expect(payload.taskName).toBe("Restock serum inventory");
        expect(payload.taskUrl).toContain(`/t/${t.id}`);
        expect(payload.assignerName).toBe("Farhana Akter");
    });

    it("does NOT email a self-assignment", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const t = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        const client = await makeLoggedInClient(actor);

        const res = await client
            .post(`/api/v1/tasks/${t.id}/assignees`)
            .send({ user_ids: [actor.id] });
        expect(res.status).toBe(204);

        await settle();
        expect(mailSpy).not.toHaveBeenCalled();
    });

    it("emails only the OTHER user when self + other are assigned together", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const other = await makeUser({ workspaceId: ws.id });
        const t = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        const client = await makeLoggedInClient(actor);

        const res = await client
            .post(`/api/v1/tasks/${t.id}/assignees`)
            .send({ user_ids: [actor.id, other.id] });
        expect(res.status).toBe(204);

        await waitForCalls(mailSpy, 1);
        await settle();
        expect(mailSpy).toHaveBeenCalledTimes(1);
        expect(mailSpy.mock.calls[0][0]).toBe(other.email);
    });

    it("re-adding an existing assignee is a no-op — no second email", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const assignee = await makeUser({ workspaceId: ws.id });
        const t = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        const client = await makeLoggedInClient(actor);

        await client
            .post(`/api/v1/tasks/${t.id}/assignees`)
            .send({ user_ids: [assignee.id] });
        await waitForCalls(mailSpy, 1);
        expect(mailSpy).toHaveBeenCalledTimes(1);

        const again = await client
            .post(`/api/v1/tasks/${t.id}/assignees`)
            .send({ user_ids: [assignee.id] });
        expect(again.status).toBe(204);

        await settle();
        expect(mailSpy).toHaveBeenCalledTimes(1);
    });

    it("a mail-layer explosion never fails the API request", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const assignee = await makeUser({ workspaceId: ws.id });
        const t = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        const client = await makeLoggedInClient(actor);
        mailSpy.mockRejectedValue(new Error("smtp down"));

        const res = await client
            .post(`/api/v1/tasks/${t.id}/assignees`)
            .send({ user_ids: [assignee.id] });

        expect(res.status).toBe(204);
        await settle(); // the rejected promise must be swallowed, not unhandled
    });
});
