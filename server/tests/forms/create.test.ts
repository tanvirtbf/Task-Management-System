import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { lists } from "../../src/db/schema";
import {
    makeUser,
    makeLoggedInClient,
    makeList,
} from "../test-utils/factories";
import { oneOff } from "../test-utils/app";
import { makeForm } from "./helpers";

/**
 * §18 #4 POST /api/v1/forms — create a form (👑 admin/owner).
 */

describe("§18 Forms — create (#4)", () => {
    it("401s without authentication", async () => {
        const res = await (await oneOff())
            .post("/api/v1/forms")
            .send({ list_id: "l-x", title: "X" });
        expect(res.status).toBe(401);
    });

    it("403s for a non-admin member (👑)", async () => {
        const u = await makeUser({ role: "member" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        const res = await client
            .post("/api/v1/forms")
            .send({ list_id: list.id, title: "Members can't" });
        expect(res.status).toBe(403);
    });

    it("creates a form with an auto-generated slug (201)", async () => {
        const u = await makeUser({ role: "admin" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });

        const res = await client.post("/api/v1/forms").send({
            list_id: list.id,
            title: "Customer Complaint",
            description: "Tell us what went wrong",
            settings: { success_message: "Got it!" },
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            list_id: list.id,
            title: "Customer Complaint",
            description: "Tell us what went wrong",
            is_public: true,
            submission_count: 0,
            fields: [],
        });
        expect(typeof res.body.id).toBe("string");
        expect(res.body.public_slug).toMatch(/^customer-complaint-/);
        expect(res.body.settings).toMatchObject({ success_message: "Got it!" });
        expect(typeof res.body.created_at).toBe("string");
    });

    it("honours an explicit public_slug", async () => {
        const u = await makeUser({ role: "owner" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        const res = await client.post("/api/v1/forms").send({
            list_id: list.id,
            title: "Beta",
            public_slug: "my-custom-slug",
        });
        expect(res.status).toBe(201);
        expect(res.body.public_slug).toBe("my-custom-slug");
    });

    it("can create a non-public (draft) form", async () => {
        const u = await makeUser({ role: "admin" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        const res = await client.post("/api/v1/forms").send({
            list_id: list.id,
            title: "Draft",
            is_public: false,
        });
        expect(res.status).toBe(201);
        expect(res.body.is_public).toBe(false);
    });

    it("409s on a duplicate explicit public_slug", async () => {
        const u = await makeUser({ role: "admin" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        await makeForm({
            listId: list.id,
            createdBy: u.id,
            publicSlug: "taken-slug",
        });

        const res = await client.post("/api/v1/forms").send({
            list_id: list.id,
            title: "Clash",
            public_slug: "taken-slug",
        });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("form.slug_taken");
    });

    it("404s when the list does not exist", async () => {
        const u = await makeUser({ role: "admin" });
        const client = await makeLoggedInClient(u);
        const res = await client
            .post("/api/v1/forms")
            .send({ list_id: "l-nope", title: "X" });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("list.not_found");
    });

    it("404s when the list is in another workspace", async () => {
        const admin = await makeUser({ role: "admin" });
        const client = await makeLoggedInClient(admin);
        const other = await makeUser({ role: "admin" });
        const otherList = await makeList({
            workspaceId: other.workspaceId,
            createdBy: other.id,
        });
        const res = await client
            .post("/api/v1/forms")
            .send({ list_id: otherList.id, title: "X" });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("list.not_found");
    });

    it("409s when the list is archived", async () => {
        const u = await makeUser({ role: "admin" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        await getDb()
            .update(lists)
            .set({ archivedAt: new Date() })
            .where(eq(lists.id, list.id));

        const res = await client
            .post("/api/v1/forms")
            .send({ list_id: list.id, title: "On archived" });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("list.archived");
    });

    it("422s when title is missing", async () => {
        const u = await makeUser({ role: "admin" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        const res = await client
            .post("/api/v1/forms")
            .send({ list_id: list.id });
        expect(res.status).toBe(422);
    });

    it("422s when list_id is missing", async () => {
        const u = await makeUser({ role: "admin" });
        const client = await makeLoggedInClient(u);
        const res = await client
            .post("/api/v1/forms")
            .send({ title: "No list" });
        expect(res.status).toBe(422);
    });
});
