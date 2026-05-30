import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser, makeLoggedInClient } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { customFields, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `PATCH /api/v1/custom-fields/:id` (§17 #4, 👑 admin/owner).
 * name/config/is_required/position updatable; type + scope immutable. Isolated
 * `tms_customfields_test`. ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const path = (id: string) => `/api/v1/custom-fields/${id}`;

const seedField = async (input: {
    workspaceId: string;
    createdBy: string;
    name?: string;
    type?: "text" | "money";
}) => {
    const id = fakeId("cf");
    await getDb()
        .insert(customFields)
        .values({
            id,
            workspaceId: input.workspaceId,
            scopeType: "workspace",
            scopeId: null,
            name: input.name ?? "Field",
            type: input.type ?? "text",
            createdBy: input.createdBy,
        });
    return id;
};
const fetchField = async (id: string) => {
    const [row] = await getDb()
        .select({
            name: customFields.name,
            isRequired: customFields.isRequired,
            position: customFields.position,
            type: customFields.type,
        })
        .from(customFields)
        .where(eq(customFields.id, id))
        .limit(1);
    return row ?? null;
};
const fetchActivityFor = async (entityId: string) =>
    getDb()
        .select({ action: workspaceActivity.action })
        .from(workspaceActivity)
        .where(eq(workspaceActivity.entityId, entityId));
const signAccess = (
    user: { id: string; workspaceId: string; role: string },
    secret: string,
    opts: jwt.SignOptions = { algorithm: "HS256", expiresIn: "15m" },
) =>
    jwt.sign(
        {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
            id: fakeId("ses"),
        },
        secret,
        opts,
    );

describe("PATCH /api/v1/custom-fields/:id", () => {
    describe("Happy path", () => {
        it("updates name/config/is_required/position (200) and persists", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.patch(path(id)).send({
                name: "Renamed",
                config: { max_length: 99 },
                is_required: true,
                position: 5,
            });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                name: "Renamed",
                is_required: true,
                position: 5,
                config: { max_length: 99 },
            });
            const row = await fetchField(id);
            expect(row).toMatchObject({
                name: "Renamed",
                isRequired: true,
                position: 5,
            });
        });

        it("an empty body is a 200 no-op returning the unchanged field", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Keep",
            });
            const client = await makeLoggedInClient(u);

            const res = await client.patch(path(id)).send({});
            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Keep");
        });

        it("writes a workspace_activity row (action=updated)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            await client.patch(path(id)).send({ name: "X" });
            const rows = await fetchActivityFor(id);
            expect(rows).toHaveLength(1);
            expect(rows[0].action).toBe("updated");
        });

        it("allows an owner to update", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            const res = await client.patch(path(id)).send({ name: "Owned" });
            expect(res.status).toBe(200);
        });
    });

    describe("Immutability", () => {
        it("rejects a type change with 422", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            const res = await client.patch(path(id)).send({ type: "money" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect((await fetchField(id))?.type).toBe("text");
        });
        it("rejects a scope_type / scope_id change with 422", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            const a = await client.patch(path(id)).send({ scope_type: "list" });
            const b = await client.patch(path(id)).send({ scope_id: "l-1" });
            expect(a.status).toBe(422);
            expect(b.status).toBe(422);
        });
    });

    describe("Not found / tenant", () => {
        it("returns 404 custom_field.not_found for an absent id", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client
                .patch(path(fakeId("cf")))
                .send({ name: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("custom_field.not_found");
        });
        it("returns 404 for another workspace's field", async () => {
            const ua = await makeUser({ role: "admin" });
            const ub = await makeUser({ role: "admin" });
            const aId = await seedField({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });
            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.patch(path(aId)).send({ name: "Hijack" });
            expect(res.status).toBe(404);
            expect((await fetchField(aId))?.name).toBe("Field");
        });
    });

    describe("Authentication & authorization (👑 admin/owner)", () => {
        it("returns 401 without a token", async () => {
            const http = await oneOff();
            const res = await http.patch(path("cf-x")).send({ name: "X" });
            expect(res.status).toBe(401);
        });
        for (const role of ["member", "guest"] as const) {
            it(`returns 403 for a ${role}`, async () => {
                const u = await makeUser({ role });
                const id = await seedField({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const client = await makeLoggedInClient(u);
                const res = await client.patch(path(id)).send({ name: "Nope" });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }
    });
});
