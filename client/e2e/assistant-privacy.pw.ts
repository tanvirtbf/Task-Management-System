import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * One person's assistant conversation must never appear to another.
 *
 * The API was never the hole — it scopes every read by the caller and a foreign
 * conversation id starts a fresh thread rather than appending. The leak was in
 * the browser: the chat store persists to localStorage under one fixed key,
 * `th-chat`, with no record of whose thread it was. Signing out scrubs it, but
 * on a shared office computer people close the tab instead — so the next person
 * to sign in rehydrated the previous person's questions, and their own first
 * message then carried that text back to the model as `history`.
 *
 * These specs seed the exact artefact the bug leaves behind and then sign in as
 * somebody else. The third one is the counterweight: your OWN thread must still
 * survive a reload, or the fix is just deletion.
 */

const PASSWORD = "Owner@12345";
const OWNER = "owner@company.local";
const OTHER = "arif@beautybooth.com.bd";
const API = "http://localhost:5501/api/v1";

const SECRET = "SECRET-QUESTION-FROM-THE-PREVIOUS-PERSON";

async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(email);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 20_000,
    });
}

async function userIdOf(
    request: APIRequestContext,
    email: string,
): Promise<string> {
    const res = await request.post(`${API}/auth/login`, {
        data: { email, password: PASSWORD },
    });
    const token = (await res.json()).access_token as string;
    const me = await (
        await request.get(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
        })
    ).json();
    return me.id as string;
}

/** The blob zustand's persist middleware leaves behind, as the app writes it. */
const seedThread = (page: Page, ownerId: string | null) =>
    page.addInitScript(
        ([key, secret, owner]) => {
            const state: Record<string, unknown> = {
                messages: [
                    {
                        id: "m1",
                        role: "user",
                        content: secret,
                        createdAt: Date.now(),
                    },
                    {
                        id: "m2",
                        role: "assistant",
                        content: "an answer only they should see",
                        createdAt: Date.now(),
                    },
                ],
                conversationId: "conv-not-yours",
            };
            // `null` reproduces a thread written before the owner was recorded —
            // which is every thread already sitting on a real machine today.
            if (owner !== null) state.ownerId = owner;
            localStorage.setItem(
                key as string,
                JSON.stringify({ state, version: 0 }),
            );
        },
        ["th-chat", SECRET, ownerId] as const,
    );

/** What the widget would actually show, and what is still on disk. */
async function threadState(page: Page) {
    return page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        return {
            messageCount: parsed?.state?.messages?.length ?? 0,
            ownerId: parsed?.state?.ownerId ?? null,
            conversationId: parsed?.state?.conversationId ?? null,
            bodyHasSecret: document.body.innerText.includes(
                "SECRET-QUESTION-FROM-THE-PREVIOUS-PERSON",
            ),
        };
    }, "th-chat");
}

test("a thread left behind by someone else is not shown to the next person", async ({
    page,
    request,
}) => {
    const otherId = await userIdOf(request, OTHER);
    await seedThread(page, otherId);

    await login(page, OWNER);
    // The widget claims the thread on mount; give it a beat, then look.
    await expect
        .poll(async () => (await threadState(page)).messageCount, {
            timeout: 10_000,
        })
        .toBe(0);

    const after = await threadState(page);
    expect(after.bodyHasSecret, "the previous person's text is on screen").toBe(
        false,
    );
    expect(
        after.conversationId,
        "their server thread id would have been reused",
    ).toBeNull();

    // And opening the panel shows nothing of theirs either.
    await page.getByRole("button", { name: "Open help assistant" }).click();
    await expect(page.getByText(SECRET)).toHaveCount(0);
});

test("a thread with NO recorded owner — every one that exists today — is dropped too", async ({
    page,
}) => {
    await seedThread(page, null);
    await login(page, OWNER);

    await expect
        .poll(async () => (await threadState(page)).messageCount, {
            timeout: 10_000,
        })
        .toBe(0);
    expect((await threadState(page)).bodyHasSecret).toBe(false);
});

test("your OWN thread still survives a reload", async ({ page, request }) => {
    const ownerId = await userIdOf(request, OWNER);

    // Signed in FIRST, then the thread is planted, then the page is reloaded.
    // Seeding before login would prove nothing: a fresh sign-in starts with a
    // failed bootstrap, whose 401 handler signs out and scrubs the chat — so
    // the thread would be gone for a reason that has nothing to do with
    // ownership. The case people actually live in is a reload with a live
    // session, and that is what this asserts.
    await login(page, OWNER);
    await page.evaluate(
        ([key, secret, owner]) => {
            localStorage.setItem(
                key as string,
                JSON.stringify({
                    state: {
                        messages: [
                            {
                                id: "m1",
                                role: "user",
                                content: secret,
                                createdAt: Date.now(),
                            },
                            {
                                id: "m2",
                                role: "assistant",
                                content: "an answer only they should see",
                                createdAt: Date.now(),
                            },
                        ],
                        conversationId: "conv-mine",
                        ownerId: owner,
                    },
                    version: 0,
                }),
            );
        },
        ["th-chat", SECRET, ownerId] as const,
    );
    await page.reload();

    await page.getByRole("button", { name: "Open help assistant" }).click();
    await expect(page.getByText(SECRET)).toBeVisible({ timeout: 10_000 });

    const state = await threadState(page);
    expect(state.messageCount).toBe(2);
    expect(state.ownerId).toBe(ownerId);
    expect(state.conversationId).toBe("conv-mine");
});
