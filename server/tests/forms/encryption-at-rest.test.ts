import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { formSubmissions } from "../../src/db/schema";
import { oneOff } from "../test-utils/app";
import {
    makeList,
    makeLoggedInClient,
    makeStatus,
    makeTaskType,
    makeUser,
} from "../test-utils/factories";
import { makeForm, makeFormField, setListDefaultTaskType } from "./helpers";

/**
 * Is a form submission actually encrypted in the DATABASE?
 *
 * Every existing test asks the API, and the API decrypts on the way out — so a
 * regression that stopped encrypting would leave all of them green. Worse, the
 * reader is deliberately lenient: `decryptSubmissionData` detects the
 * `{ciphertext, iv, authTag}` envelope and, on any failure, "returns the stored
 * value unchanged so a single bad row never 500s the whole page". That is the
 * right call for legacy rows and precisely why plaintext would go unnoticed.
 *
 * These forms carry customer names, phone numbers and addresses (the CS and
 * delivery intake), so this reads the raw column and asserts the plaintext is
 * NOT in it — the one question the round-trip cannot answer.
 */

jest.setTimeout(30_000);

const PHONE = "01711223344";
const NAME = "Rehana Sultana";
const ADDRESS = "House 42, Road 7, Dhanmondi";

/** A public, submittable form plus a client that can read its submissions. */
const seedPublicForm = async () => {
    const u = await makeUser({ role: "admin" });
    const client = await makeLoggedInClient(u);
    const list = await makeList({ workspaceId: u.workspaceId, createdBy: u.id });
    const tt = await makeTaskType({ workspaceId: u.workspaceId });
    await setListDefaultTaskType(list.id, tt.id);
    await makeStatus({ scopeId: list.id, statusGroup: "not_started" });
    const form = await makeForm({
        listId: list.id,
        createdBy: u.id,
        title: "Delivery complaint",
        isPublic: true,
    });
    await makeFormField({
        formId: form.id,
        fieldKind: "task_attr",
        fieldKey: "name",
        label: "Your name",
        isRequired: true,
    });
    return { u, client, list, formId: form.id, slug: form.publicSlug };
};

const rawStored = async (submissionId: string): Promise<string> => {
    const [row] = await getDb()
        .select({ data: formSubmissions.data })
        .from(formSubmissions)
        .where(eq(formSubmissions.id, submissionId));
    // The JSON column surfaces as a string or a parsed object depending on the
    // driver; either way, what matters is whether the secrets appear in it.
    return typeof row.data === "string"
        ? row.data
        : JSON.stringify(row.data);
};

describe("form submissions are encrypted at rest", () => {
    it("stores an AES envelope, not the customer's details", async () => {
        const f = await seedPublicForm();

        const res = await (await oneOff())
            .post(`/api/v1/public/forms/${f.slug}/submit`)
            .send({
                data: {
                    name: NAME,
                    phone: PHONE,
                    address: ADDRESS,
                },
            });
        expect(res.status).toBe(201);

        const stored = await rawStored(res.body.submission_id);

        // The envelope shape is there …
        const env = JSON.parse(stored) as Record<string, unknown>;
        expect(Object.keys(env).sort()).toEqual([
            "authTag",
            "ciphertext",
            "iv",
        ]);
        expect(typeof env.ciphertext).toBe("string");
        expect(env.ciphertext as string).toMatch(/^[0-9a-f]+$/);

        // … and none of the customer's data is readable in it.
        for (const secret of [NAME, PHONE, ADDRESS]) {
            expect(stored).not.toContain(secret);
        }
        // Not even the field NAMES leak the shape of what was asked.
        expect(stored).not.toContain("phone");
    });

    it("two identical submissions do not produce identical ciphertext", async () => {
        const f = await seedPublicForm();
        const body = { data: { name: NAME, phone: PHONE } };

        const a = await (await oneOff())
            .post(`/api/v1/public/forms/${f.slug}/submit`)
            .send(body);
        const b = await (await oneOff())
            .post(`/api/v1/public/forms/${f.slug}/submit`)
            .send(body);
        expect(a.status).toBe(201);
        expect(b.status).toBe(201);

        const [ra, rb] = await Promise.all([
            rawStored(a.body.submission_id),
            rawStored(b.body.submission_id),
        ]);

        // A random IV per row. Without it, equal plaintext gives equal
        // ciphertext and the store leaks which customers said the same thing.
        expect(ra).not.toBe(rb);
        expect(
            (JSON.parse(ra) as { iv: string }).iv,
        ).not.toBe((JSON.parse(rb) as { iv: string }).iv);
    });

    it("the admin read path still returns the plaintext it hid", async () => {
        const f = await seedPublicForm();
        const res = await (await oneOff())
            .post(`/api/v1/public/forms/${f.slug}/submit`)
            .send({ data: { name: NAME, phone: PHONE } });
        expect(res.status).toBe(201);

        const listed = await f.client.get(`/api/v1/forms/${f.formId}/submissions`);

        expect(listed.status).toBe(200);
        const row = (listed.body.data as Array<{ id: string; data: Record<string, unknown> }>)
            .find((r) => r.id === res.body.submission_id);
        expect(row).toBeDefined();
        // Encryption is only worth having if the people who need the data can
        // still read it — otherwise the next person "fixes" it by removing it.
        expect(row!.data.phone).toBe(PHONE);
        expect(row!.data.name).toBe(NAME);
    });
});
