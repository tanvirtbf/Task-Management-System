import { eq } from "drizzle-orm";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { comments, notifications } from "../../src/db/schema";
import logger from "../../src/config/logger";
import { MailService } from "../../src/services/MailService";

/**
 * What happens to markup somebody types into a comment (P5 XSS probe; the
 * deep-dive is P7).
 *
 * The answer this pins is deliberate and worth stating, because "no server-side
 * sanitisation" reads like a hole until you follow the body to where it is
 * rendered:
 *
 *   - The API stores and returns the text VERBATIM. Escaping at write time
 *     would corrupt legitimate text — a comment about `<Button>` or a snippet of
 *     JSON — and the damage would be permanent and invisible.
 *   - The UI renders it as TEXT: `MentionRenderer` emits React text children, so
 *     markup arrives as characters, not nodes. Nothing calls
 *     `dangerouslySetInnerHTML` on a comment body.
 *   - The ONE place the body becomes HTML is the mention email, and that
 *     template escapes it.
 *
 * So the contract has two halves and both are asserted here: the store is
 * faithful, and the only HTML sink escapes.
 */

jest.setTimeout(30_000);

const listPath = (taskId: string) => `/api/v1/tasks/${taskId}/comments`;
const onePath = (id: string) => `/api/v1/comments/${id}`;

/** One string carrying every shape that has ever mattered. */
const HOSTILE =
    `<script>alert(1)</script> <img src=x onerror="alert(2)"> ` +
    `"double" 'single' & < > \\ ${"`backtick`"} \${notATemplate} <b>bold</b>`;

type SentMessage = { to: string; subject: string; html: string; text: string };

const captureSend = () => {
    const sent: SentMessage[] = [];
    jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(MailService.prototype as any, "send")
        .mockImplementation(async (...args: unknown[]) => {
            sent.push(args[0] as SentMessage);
        });
    return sent;
};

afterEach(() => jest.restoreAllMocks());

const scene = async () => {
    const ws = await makeWorkspace();
    const author = await makeUser({ workspaceId: ws.id, role: "member" });
    const alice = await makeUser({
        workspaceId: ws.id,
        email: "alice@example.test",
    });
    const client = await makeLoggedInClient(author);
    const task = await makeTask({ workspaceId: ws.id, createdBy: author.id });
    return { ws, author, alice, client, task };
};

describe("Comment bodies carrying markup", () => {
    describe("The store is faithful", () => {
        it("returns the body byte-for-byte on create", async () => {
            const s = await scene();

            const res = await s.client
                .post(listPath(s.task.id))
                .send({ body: HOSTILE });

            expect(res.status).toBe(201);
            expect(res.body.body).toBe(HOSTILE);
        });

        it("stores it byte-for-byte", async () => {
            const s = await scene();
            const res = await s.client
                .post(listPath(s.task.id))
                .send({ body: HOSTILE });

            const [row] = await getDb()
                .select()
                .from(comments)
                .where(eq(comments.id, res.body.id));
            expect(row.body).toBe(HOSTILE);
        });

        it("reads it back byte-for-byte", async () => {
            const s = await scene();
            await s.client.post(listPath(s.task.id)).send({ body: HOSTILE });

            const res = await s.client.get(listPath(s.task.id));

            expect(res.status).toBe(200);
            expect(res.body[0].body).toBe(HOSTILE);
        });

        it("survives an edit unchanged", async () => {
            const s = await scene();
            const created = await s.client
                .post(listPath(s.task.id))
                .send({ body: "plain" });

            const res = await s.client
                .patch(onePath(created.body.id))
                .send({ body: HOSTILE });

            expect(res.status).toBe(200);
            expect(res.body.body).toBe(HOSTILE);
        });

        it("carries markup into the mention notification body as text", async () => {
            const s = await scene();

            await s.client
                .post(listPath(s.task.id))
                .send({ body: `@alice ${HOSTILE}` });

            const [notif] = await getDb()
                .select()
                .from(notifications)
                .where(eq(notifications.userId, s.alice.id));
            expect(notif.type).toBe("mentioned");
            // The excerpt is a 140-char prefix of the body, unmodified.
            expect(notif.body).toBe(`@alice ${HOSTILE}`.slice(0, 140));
        });
    });

    describe("The one HTML sink escapes", () => {
        it("escapes the excerpt, the actor name and the task name in the mention email", async () => {
            const sent = captureSend();

            await new MailService(logger).sendMentionEmail("alice@x.test", {
                actorName: "<script>alert('actor')</script>",
                taskName: "<img src=x onerror=alert('task')>",
                taskUrl: "https://tasks.beautybooth.com.bd/tasks/t-1",
                excerpt: HOSTILE,
            });

            expect(sent).toHaveLength(1);
            const { html } = sent[0];
            // What makes it safe is that no TAG survives. `onerror=` still
            // appears as characters inside `&lt;img …&gt;`, and that is fine —
            // asserting its absence would be asserting the wrong thing.
            expect(html).not.toContain("<script");
            expect(html).not.toContain("<img");
            expect(html).toContain("&lt;script&gt;");
            expect(html).toContain("&lt;img src=x onerror=alert(&#39;task&#39;)&gt;");
        });

        it("leaves the plain-text part unescaped — it is not a markup context", async () => {
            const sent = captureSend();

            await new MailService(logger).sendMentionEmail("alice@x.test", {
                actorName: "Rahim",
                taskName: "Eid campaign",
                taskUrl: "https://tasks.beautybooth.com.bd/tasks/t-1",
                excerpt: "<b>bold</b>",
            });

            expect(sent[0].text).toContain("<b>bold</b>");
        });
    });
});
