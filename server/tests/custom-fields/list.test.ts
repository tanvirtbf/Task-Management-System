import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser, makeLoggedInClient } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { customFields, customFieldOptions } from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `GET /api/v1/custom-fields` (§17 #1). Runs on the isolated
 * `tms_customfields_test` DB. ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const PATH = "/api/v1/custom-fields";

type FieldType = "text" | "phone" | "money" | "date" | "dropdown" | "files";
type ScopeType = "workspace" | "space" | "list";

const seedField = async (input: {
    workspaceId: string;
    createdBy: string;
    scopeType?: ScopeType;
    scopeId?: string | null;
    name?: string;
    type?: FieldType;
    config?: Record<string, unknown>;
    position?: number;
}) => {
    const id = fakeId("cf");
    await getDb()
        .insert(customFields)
        .values({
            id,
            workspaceId: input.workspaceId,
            scopeType: input.scopeType ?? "workspace",
            scopeId: input.scopeId ?? null,
            name: input.name ?? "Field",
            type: input.type ?? "text",
            config: input.config ?? {},
            position: input.position ?? 0,
            createdBy: input.createdBy,
        });
    return id;
};
const seedOption = async (
    customFieldId: string,
    label: string,
    position = 0,
) => {
    const id = fakeId("cfo");
    await getDb()
        .insert(customFieldOptions)
        .values({ id, customFieldId, label, position });
    return id;
};

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

const WIRE_KEYS = [
    "id",
    "scope_type",
    "scope_id",
    "name",
    "type",
    "config",
    "is_required",
    // F26 (ISS-042): the guest-redaction flag reaches the wire at last — the
    // redaction always worked, the column was in no serializer.
    "hidden_from_guests",
    "default_value",
    "position",
].sort();

describe("GET /api/v1/custom-fields", () => {
    describe("Happy path", () => {
        it("returns the workspace's fields as a bare array in the exact wire shape", async () => {
            const u = await makeUser({ role: "admin" });
            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Tracking ID",
                type: "text",
                config: { max_length: 60 },
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body).toHaveLength(1);
            const f = res.body[0];
            expect(Object.keys(f).sort()).toEqual(WIRE_KEYS);
            expect(f).toMatchObject({
                name: "Tracking ID",
                type: "text",
                scope_type: "workspace",
                scope_id: null,
                is_required: false,
                config: { max_length: 60 },
            });
            expect(f).not.toHaveProperty("workspace_id");
            // F26 (ISS-042): `hidden_from_guests` is now DELIBERATELY on the
            // wire — it is the one guest-redaction control the product
            // implements, and it appeared in no serializer, so it could not be
            // switched on except by hand in SQL.
            expect(f).toHaveProperty("hidden_from_guests", false);
            expect(f).not.toHaveProperty("created_by");
        });

        it("returns an empty array when the workspace has no fields", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const res = await client.get(PATH);
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("inlines options for a dropdown field (and omits options for others)", async () => {
            const u = await makeUser({ role: "admin" });
            const dd = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Source",
                type: "dropdown",
            });
            await seedOption(dd, "Facebook", 0);
            await seedOption(dd, "Instagram", 1);
            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Note",
                type: "text",
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);
            const dropdown = res.body.find(
                (f: { type: string }) => f.type === "dropdown",
            );
            const text = res.body.find(
                (f: { type: string }) => f.type === "text",
            );

            expect(dropdown.options).toHaveLength(2);
            expect(dropdown.options[0]).toMatchObject({
                label: "Facebook",
                position: 0,
            });
            expect(dropdown.options[0].id).toMatch(/^cfo-/);
            expect(text).not.toHaveProperty("options");
        });

        it("responds as JSON with an X-Request-Id header", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const res = await client.get(PATH);
            expect(res.get("content-type")).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    describe("Scope filter", () => {
        it("narrows by ?scope_type and ?scope_id", async () => {
            const u = await makeUser({ role: "admin" });
            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "WS",
                scopeType: "workspace",
            });
            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Listed",
                scopeType: "list",
                scopeId: "l-123",
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(
                `${PATH}?scope_type=list&scope_id=l-123`,
            );
            expect(res.body).toHaveLength(1);
            expect(res.body[0].name).toBe("Listed");
        });

        it("returns 422 for an invalid scope_type", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const res = await client.get(`${PATH}?scope_type=bogus`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("Authentication", () => {
        it("returns 401 without a token", async () => {
            const http = await oneOff();
            const res = await http.get(PATH);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
        it("returns 401 for an expired token", async () => {
            const u = await makeUser();
            const expired = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                algorithm: "HS256",
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(PATH)
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Authorization (🔐 any member)", () => {
        for (const role of ["owner", "admin", "member", "guest"] as const) {
            it(`allows a ${role} to list (200)`, async () => {
                const u = await makeUser({ role });
                const client = await makeLoggedInClient(u);
                const res = await client.get(PATH);
                expect(res.status).toBe(200);
            });
        }
    });

    describe("Tenant isolation", () => {
        it("returns only the caller's workspace fields", async () => {
            const ua = await makeUser({ role: "admin" });
            const ub = await makeUser({ role: "admin" });
            await seedField({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
                name: "A-Field",
            });
            const clientB = await makeLoggedInClient(ub);

            const res = await clientB.get(PATH);
            expect(res.body).toEqual([]);
        });
    });
});
