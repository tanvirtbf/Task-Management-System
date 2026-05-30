import jwt from "jsonwebtoken";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeList,
    makeSpace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { customFields } from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `GET /api/v1/lists/:listId/custom-fields` (§17 #2) — the union of
 * workspace + the list's space + list-scoped fields. Isolated
 * `tms_customfields_test`. ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const path = (listId: string) => `/api/v1/lists/${listId}/custom-fields`;
type ScopeType = "workspace" | "space" | "list";

const seedField = async (input: {
    workspaceId: string;
    createdBy: string;
    name: string;
    scopeType: ScopeType;
    scopeId?: string | null;
}) => {
    const id = fakeId("cf");
    await getDb()
        .insert(customFields)
        .values({
            id,
            workspaceId: input.workspaceId,
            scopeType: input.scopeType,
            scopeId: input.scopeId ?? null,
            name: input.name,
            type: "text",
            createdBy: input.createdBy,
        });
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

describe("GET /api/v1/lists/:listId/custom-fields", () => {
    describe("Happy path — scope union", () => {
        it("returns workspace + space + list scoped fields, excluding other scopes", async () => {
            const u = await makeUser({ role: "admin" });
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const otherSpace = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const otherList = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });

            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "WS",
                scopeType: "workspace",
            });
            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "ThisSpace",
                scopeType: "space",
                scopeId: list.spaceId,
            });
            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "ThisList",
                scopeType: "list",
                scopeId: list.id,
            });
            // Excluded: a different space + a different list.
            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "OtherSpace",
                scopeType: "space",
                scopeId: otherSpace.id,
            });
            await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "OtherList",
                scopeType: "list",
                scopeId: otherList.id,
            });

            const client = await makeLoggedInClient(u);
            const res = await client.get(path(list.id));

            expect(res.status).toBe(200);
            const names = res.body.map((f: { name: string }) => f.name).sort();
            expect(names).toEqual(["ThisList", "ThisSpace", "WS"]);
        });

        it("returns an empty array for a list with no applicable fields", async () => {
            const u = await makeUser();
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            const res = await client.get(path(list.id));
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });
    });

    describe("Not found / tenant isolation", () => {
        it("returns 404 list.not_found for an absent list", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const res = await client.get(path(fakeId("l")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("returns 404 for another workspace's list", async () => {
            const ua = await makeUser();
            const ub = await makeUser();
            const aList = await makeList({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });
            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.get(path(aList.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });

    describe("Authentication & authorization", () => {
        it("returns 401 without a token", async () => {
            const http = await oneOff();
            const res = await http.get(path("l-x"));
            expect(res.status).toBe(401);
        });
        for (const role of ["owner", "admin", "member", "guest"] as const) {
            it(`allows a ${role} (200)`, async () => {
                const u = await makeUser({ role });
                const list = await makeList({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const client = await makeLoggedInClient(u);
                const res = await client.get(path(list.id));
                expect(res.status).toBe(200);
            });
        }
    });
});
