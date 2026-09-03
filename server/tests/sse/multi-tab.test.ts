import { framesOfType, insertNotification, openStream, seed, sleep } from "./_helpers";
import { makeLoggedInClient } from "../test-utils/factories";

/**
 * Two tabs, one person.
 *
 * Everything else in this suite opens a single stream, and a single stream
 * cannot see the failure that matters here: a per-user registry that keys on
 * the USER rather than the CONNECTION delivers to whichever tab registered
 * last, and the other one goes quiet. Nobody would report that as a bug —
 * they would say "the inbox is flaky" — and every existing test would pass.
 *
 * People here work with the app open in more than one tab all day (a task in
 * one, the inbox in another), so this is the ordinary case, not an edge one.
 */

jest.setTimeout(30_000);

describe("the inbox stream with more than one tab open", () => {
    it("delivers the same notification to BOTH of one person's connections", async () => {
        const { user, client } = await seed();
        // A second sign-in, as a second tab would be. Its own token, its own
        // connection.
        const secondTab = await makeLoggedInClient({
            id: user.id,
            workspaceId: user.workspaceId,
            role: user.role,
        });

        const tabA = openStream(client, { idleMs: 900 });
        const tabB = openStream(secondTab, { idleMs: 900 });
        await sleep(220); // both streams open and their cursors established

        await insertNotification({
            userId: user.id,
            title: "Two tabs, one ping",
        });

        const [resA, resB] = await Promise.all([tabA, tabB]);

        for (const [label, res] of [
            ["tab A", resA],
            ["tab B", resB],
        ] as const) {
            const notifs = framesOfType(res.text, "notification");
            expect({ label, count: notifs.length }).toEqual({
                label,
                count: 1,
            });
            expect(JSON.parse(notifs[0].data).title).toBe("Two tabs, one ping");
        }
    });

    it("gives each tab its own hello frame rather than reusing one stream", async () => {
        const { user } = await seed();
        const one = await makeLoggedInClient({
            id: user.id,
            workspaceId: user.workspaceId,
            role: user.role,
        });
        const two = await makeLoggedInClient({
            id: user.id,
            workspaceId: user.workspaceId,
            role: user.role,
        });

        const [a, b] = await Promise.all([
            openStream(one, { idleMs: 400 }),
            openStream(two, { idleMs: 400 }),
        ]);

        expect(framesOfType(a.text, "connected")).toHaveLength(1);
        expect(framesOfType(b.text, "connected")).toHaveLength(1);
    });

    it("closing one tab does not stop delivery to the other", async () => {
        const { user, client } = await seed();
        const secondTab = await makeLoggedInClient({
            id: user.id,
            workspaceId: user.workspaceId,
            role: user.role,
        });

        // The short-lived tab closes while the long-lived one is still open.
        const shortLived = openStream(secondTab, { idleMs: 150 });
        const longLived = openStream(client, { idleMs: 1200 });
        await sleep(400); // the short one has already idle-closed by now
        await shortLived;

        await insertNotification({
            userId: user.id,
            title: "Still listening",
        });

        const res = await longLived;
        const notifs = framesOfType(res.text, "notification");
        expect(notifs).toHaveLength(1);
        expect(JSON.parse(notifs[0].data).title).toBe("Still listening");
    });
});
