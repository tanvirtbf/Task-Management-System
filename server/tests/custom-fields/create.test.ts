import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeSpace,
    makeList,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { customFields, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `POST /api/v1/custom-fields` (§17 #3, 👑 admin/owner). Marquee
 * rules: type ∈ 6 (else 422 custom_field.unsupported_type), scope_id validated.
 * Isolated `tms_customfields_test`. ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const PATH = "/api/v1/custom-fields";

const validBody = (over: Record<string, unknown> = {}) => ({
    scope_type: "workspace",
    name: "Tracking ID",
    type: "text",
    config: { max_length: 60 },
    is_required: false,
    ...over,
});

const fetchField = async (id: string) => {
    const [row] = await getDb()
        .select({
            id: customFields.id,
            workspaceId: customFields.workspaceId,
            type: customFields.type,
            scopeType: customFields.scopeType,
            scopeId: customFields.scopeId,
            createdBy: customFields.createdBy,
        })
        .from(customFields)
        .where(eq(customFields.id, id))
        .limit(1);
    return row ?? null;
};
const fetchActivityFor = async (entityId: string) =>
    getDb()
        .select({
            entityType: workspaceActivity.entityType,
            action: workspaceActivity.action,
            actorId: workspaceActivity.actorId,
        })
        .from(workspaceActivity)
        .where(eq(workspaceActivity.entityId, entityId));
const countFields = async (workspaceId: string) =>
    (
        await getDb()
            .select({ id: customFields.id })
            .from(customFields)
            .where(eq(customFields.workspaceId, workspaceId))
    ).length;

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

describe("POST /api/v1/custom-fields", () => {
    describe("Happy path", () => {
        it("creates a text field (201) with the wire shape for an admin", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(PATH).send(validBody());

            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({
                name: "Tracking ID",
                type: "text",
                scope_type: "workspace",
                scope_id: null,
                is_required: false,
                config: { max_length: 60 },
                position: 0,
            });
            expect(res.body.id).toMatch(/^cf-/);
            expect(res.body).not.toHaveProperty("workspace_id");

            const row = await fetchField(res.body.id);
            expect(row?.workspaceId).toBe(u.workspaceId);
            expect(row?.createdBy).toBe(u.id);
        });

        it("allows an owner to create", async () => {
            const u = await makeUser({ role: "owner" });
            const client = await makeLoggedInClient(u);
            const res = await client.post(PATH).send(validBody());
            expect(res.status).toBe(201);
        });

        it("creates a dropdown field with inline options", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(PATH).send(
                validBody({
                    name: "Source",
                    type: "dropdown",
                    config: {},
                    options: [
                        { label: "Facebook", color: "#1877F2", position: 0 },
                        { label: "Instagram", position: 1 },
                    ],
                }),
            );

            expect(res.status).toBe(201);
            expect(res.body.type).toBe("dropdown");
            expect(res.body.options).toHaveLength(2);
            expect(res.body.options[0]).toMatchObject({
                label: "Facebook",
                color: "#1877F2",
                position: 0,
            });
            expect(res.body.options[0].id).toMatch(/^cfo-/);
        });

        it("writes a workspace_activity row (entity_type=custom_field, action=created)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client.post(PATH).send(validBody());

            const rows = await fetchActivityFor(res.body.id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                entityType: "custom_field",
                action: "created",
                actorId: u.id,
            });
        });

        it("creates space- and list-scoped fields with a valid scope_id", async () => {
            const u = await makeUser({ role: "admin" });
            const space = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const spaceRes = await client
                .post(PATH)
                .send(validBody({ scope_type: "space", scope_id: space.id }));
            const listRes = await client
                .post(PATH)
                .send(validBody({ scope_type: "list", scope_id: list.id }));

            expect(spaceRes.status).toBe(201);
            expect(spaceRes.body.scope_id).toBe(space.id);
            expect(listRes.status).toBe(201);
            expect(listRes.body.scope_id).toBe(list.id);
        });
    });

    describe("Type validation (marquee)", () => {
        it("rejects an unsupported type with 422 custom_field.unsupported_type", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            for (const bad of ["long_text", "email", "number", "location"]) {
                const res = await client
                    .post(PATH)
                    .send(validBody({ type: bad }));
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe(
                    "custom_field.unsupported_type",
                );
            }
        });
    });

    describe("Scope validation", () => {
        it("rejects scope_id present on a workspace-scoped field (422)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client
                .post(PATH)
                .send(validBody({ scope_type: "workspace", scope_id: "sp-x" }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("requires scope_id for a space/list-scoped field (422)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client
                .post(PATH)
                .send(validBody({ scope_type: "space" }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects a scope_id that is not a real space/list in the workspace (422 custom_field.invalid_scope)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client
                .post(PATH)
                .send(
                    validBody({ scope_type: "space", scope_id: fakeId("sp") }),
                );
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("custom_field.invalid_scope");
        });

        it("rejects options on a non-dropdown field (422)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client
                .post(PATH)
                .send(validBody({ type: "text", options: [{ label: "X" }] }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("Validation", () => {
        const expect422 = (res: {
            status: number;
            body: { error: { code: string } };
        }) => {
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        };
        it("rejects a missing name", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const body = validBody();
            delete (body as { name?: string }).name;
            expect422(await client.post(PATH).send(body));
        });
        it("rejects a missing/invalid scope_type", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            expect422(
                await client.post(PATH).send(validBody({ scope_type: "nope" })),
            );
        });
    });

    describe("Authentication & authorization (👑 admin/owner)", () => {
        it("returns 401 without a token", async () => {
            const http = await oneOff();
            const res = await http.post(PATH).send(validBody());
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
        for (const role of ["member", "guest"] as const) {
            it(`returns 403 auth.forbidden for a ${role} and writes nothing`, async () => {
                const u = await makeUser({ role });
                const client = await makeLoggedInClient(u);
                const res = await client.post(PATH).send(validBody());
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await countFields(u.workspaceId)).toBe(0);
            });
        }
        it("enforces precedence: member with an invalid body still gets 403", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const res = await client.post(PATH).send({ type: "bogus" });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });
    });
});
