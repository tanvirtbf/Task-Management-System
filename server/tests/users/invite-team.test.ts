import { and, eq } from "drizzle-orm";
import {
    makeUser,
    makeSpace,
    makeWorkspace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { userRoleGrants, users, workspaceActivity } from "../../src/db/schema";

/**
 * Team-access P1 (B3) — inviting someone INTO a team. `POST /users/invite`
 * accepts `space_id`; the invited row gets that home team + a Member-role
 * space grant inside the same transaction, so nobody arrives teamless when
 * visibility later narrows (plan P6). Omitting `space_id` stays valid on the
 * wire (the client form requires it; the server tightens at P6's pre-flight).
 *
 * Harness mirrors `invite.test.ts`: factories + HTTP; per-test truncation.
 */
jest.setTimeout(30000);

const INVITE = "/api/v1/users/invite";

const membershipRows = async (userId: string, spaceId: string) =>
    getDb()
        .select({ id: userRoleGrants.id })
        .from(userRoleGrants)
        .where(
            and(
                eq(userRoleGrants.userId, userId),
                eq(userRoleGrants.scopeType, "space"),
                eq(userRoleGrants.scopeId, spaceId),
            ),
        );

const userRow = async (userId: string) => {
    const rows = await getDb()
        .select({
            id: users.id,
            primarySpaceId: users.primarySpaceId,
            status: users.status,
        })
        .from(users)
        .where(eq(users.id, userId));
    return rows[0] ?? null;
};

const adminClient = async () => {
    const ws = await makeWorkspace();
    const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
    const client = await makeLoggedInClient({
        id: admin.id,
        workspaceId: ws.id,
        role: "admin",
    });
    return { ws, admin, client };
};

describe("POST /users/invite with space_id (team-access P1)", () => {
    it("201: the invited row carries the home team + a Member space grant", async () => {
        const { ws, admin, client } = await adminClient();
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: admin.id,
        });

        const res = await client.post(INVITE).send({
            first_name: "Nadia",
            last_name: "Rahman",
            email: "nadia.team@example.test",
            role: "member",
            space_id: space.id,
        });
        expect(res.status).toBe(201);
        const invitedId = res.body.id as string;

        const row = await userRow(invitedId);
        expect(row?.status).toBe("invited");
        expect(row?.primarySpaceId).toBe(space.id);
        expect(await membershipRows(invitedId, space.id)).toHaveLength(1);

        // The audit row names the team.
        const [activity] = await getDb()
            .select({ context: workspaceActivity.context })
            .from(workspaceActivity)
            .where(
                and(
                    eq(workspaceActivity.entityId, invitedId),
                    eq(workspaceActivity.action, "invited"),
                ),
            );
        expect(
            (activity?.context as { space_id?: string | null })?.space_id,
        ).toBe(space.id);
    });

    it("a guest can be invited into a team too", async () => {
        const { ws, admin, client } = await adminClient();
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: admin.id,
        });

        const res = await client.post(INVITE).send({
            first_name: "Guest",
            last_name: "Person",
            email: "guest.team@example.test",
            role: "guest",
            space_id: space.id,
        });
        expect(res.status).toBe(201);
        expect((await userRow(res.body.id as string))?.primarySpaceId).toBe(
            space.id,
        );
    });

    it("422 team.space_invalid for an unknown or archived space — nothing is written", async () => {
        const { ws, admin, client } = await adminClient();
        const archived = await makeSpace({
            workspaceId: ws.id,
            createdBy: admin.id,
            archivedAt: new Date(),
        });

        for (const spaceId of ["sp-missing", archived.id]) {
            const res = await client.post(INVITE).send({
                first_name: "Nobody",
                last_name: "Lands",
                email: "nobody.lands@example.test",
                role: "member",
                space_id: spaceId,
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("team.space_invalid");
        }
        const orphan = await getDb()
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, "nobody.lands@example.test"));
        expect(orphan).toHaveLength(0);
    });

    it("space_id stays optional on the wire: omitted → no team, null → no team", async () => {
        const { client } = await adminClient();

        const omitted = await client.post(INVITE).send({
            first_name: "Old",
            last_name: "Wire",
            email: "old.wire@example.test",
            role: "member",
        });
        expect(omitted.status).toBe(201);
        expect(
            (await userRow(omitted.body.id as string))?.primarySpaceId,
        ).toBeNull();

        const asNull = await client.post(INVITE).send({
            first_name: "Null",
            last_name: "Wire",
            email: "null.wire@example.test",
            role: "member",
            space_id: null,
        });
        expect(asNull.status).toBe(201);
        expect(
            (await userRow(asNull.body.id as string))?.primarySpaceId,
        ).toBeNull();
    });

    it("cross-workspace space_id reads as unknown (422), never a membership", async () => {
        const { client } = await adminClient();
        const otherWs = await makeWorkspace();
        const foreignAdmin = await makeUser({
            workspaceId: otherWs.id,
            role: "admin",
        });
        const foreignSpace = await makeSpace({
            workspaceId: otherWs.id,
            createdBy: foreignAdmin.id,
        });

        const res = await client.post(INVITE).send({
            first_name: "Cross",
            last_name: "Tenant",
            email: "cross.tenant@example.test",
            role: "member",
            space_id: foreignSpace.id,
        });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("team.space_invalid");
    });
});
