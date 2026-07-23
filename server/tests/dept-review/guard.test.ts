import { getDb } from "../../src/db/client";
import logger from "../../src/config/logger";
import { SpacesRepo } from "../../src/repositories/SpacesRepo";
import { TasksRepo } from "../../src/repositories/TasksRepo";
import { ReviewsRepo } from "../../src/repositories/ReviewsRepo";
import { TaskActivityRepo } from "../../src/repositories/TaskActivityRepo";
import { NotificationsRepo } from "../../src/repositories/NotificationsRepo";
import { UsersRepo } from "../../src/repositories/UsersRepo";
import {
    ReviewsService,
    isHeadOfSpace,
} from "../../src/services/ReviewsService";
import { AppError } from "../../src/errors";
import type { Role } from "../../src/constants";
import { makeSpace, makeUser } from "../test-utils/factories";
import { makeSpaceWithHead } from "./helpers";
import { fakeId } from "../../src/utils";

/**
 * Dept Review V1 — P6: `ReviewsService.requireHeadOrAdmin` unit matrix.
 *
 * Service-level tests (no HTTP — the first consuming endpoint ships in P8):
 * the service is instantiated directly against the suite's private DB, with
 * rows seeded through the real factories.
 */

const service = () => {
    const db = getDb();
    return new ReviewsService(
        db,
        new SpacesRepo(db),
        new TasksRepo(db),
        new ReviewsRepo(db),
        new TaskActivityRepo(db),
        new NotificationsRepo(db),
        new UsersRepo(db),
        logger,
    );
};

const guardInput = (
    spaceId: string,
    user: { id: string; workspaceId: string; role: Role },
) => ({
    spaceId,
    workspaceId: user.workspaceId,
    userId: user.id,
    role: user.role,
});

const expectAppError = async (
    p: Promise<unknown>,
    statusCode: number,
    code: string,
) => {
    await expect(p).rejects.toBeInstanceOf(AppError);
    await expect(p).rejects.toMatchObject({ statusCode, code });
};

describe("ReviewsService.requireHeadOrAdmin (Dept Review V1 guard)", () => {
    describe("allowed callers", () => {
        it("resolves for the space's head (a plain member) and returns the record", async () => {
            const owner = await makeUser({ role: "owner" });
            const head = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            const sp = await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                headUserId: head.id,
                createdBy: owner.id,
            });

            const space = await service().requireHeadOrAdmin(
                guardInput(sp.id, { ...head, role: "member" }),
            );

            expect(space.id).toBe(sp.id);
            expect(space.headUserId).toBe(head.id);
        });

        it("resolves for an owner who is not the head", async () => {
            const owner = await makeUser({ role: "owner" });
            const sp = await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                createdBy: owner.id,
            });

            const space = await service().requireHeadOrAdmin(
                guardInput(sp.id, { ...owner, role: "owner" }),
            );
            expect(space.id).toBe(sp.id);
        });

        it("resolves for an admin who is not the head (even when the space is headless)", async () => {
            const owner = await makeUser({ role: "owner" });
            const admin = await makeUser({
                workspaceId: owner.workspaceId,
                role: "admin",
            });
            const sp = await makeSpace({
                workspaceId: owner.workspaceId,
                createdBy: owner.id,
            }); // no head at all

            const space = await service().requireHeadOrAdmin(
                guardInput(sp.id, { ...admin, role: "admin" }),
            );
            expect(space.id).toBe(sp.id);
            expect(space.headUserId).toBeNull();
        });
    });

    describe("403 review.not_head", () => {
        it("rejects a member who is not the head", async () => {
            const owner = await makeUser({ role: "owner" });
            const member = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            const sp = await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                createdBy: owner.id,
            });

            await expectAppError(
                service().requireHeadOrAdmin(
                    guardInput(sp.id, { ...member, role: "member" }),
                ),
                403,
                "review.not_head",
            );
        });

        it("rejects a guest", async () => {
            const owner = await makeUser({ role: "owner" });
            const guest = await makeUser({
                workspaceId: owner.workspaceId,
                role: "guest",
            });
            const sp = await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                createdBy: owner.id,
            });

            await expectAppError(
                service().requireHeadOrAdmin(
                    guardInput(sp.id, { ...guest, role: "guest" }),
                ),
                403,
                "review.not_head",
            );
        });

        it("rejects the head of a DIFFERENT space (headship does not transfer)", async () => {
            const owner = await makeUser({ role: "owner" });
            const headA = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                headUserId: headA.id,
                createdBy: owner.id,
            });
            const spaceB = await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                createdBy: owner.id,
            });

            await expectAppError(
                service().requireHeadOrAdmin(
                    guardInput(spaceB.id, { ...headA, role: "member" }),
                ),
                403,
                "review.not_head",
            );
        });
    });

    describe("404 space.not_found", () => {
        it("rejects an unknown space id", async () => {
            const owner = await makeUser({ role: "owner" });

            await expectAppError(
                service().requireHeadOrAdmin(
                    guardInput(fakeId("sp"), { ...owner, role: "owner" }),
                ),
                404,
                "space.not_found",
            );
        });

        it("rejects another workspace's space id — even for its own head (no cross-tenant oracle)", async () => {
            const ownerA = await makeUser({ role: "owner" });
            const headA = await makeUser({
                workspaceId: ownerA.workspaceId,
                role: "member",
            });
            const spA = await makeSpaceWithHead({
                workspaceId: ownerA.workspaceId,
                headUserId: headA.id,
                createdBy: ownerA.id,
            });

            const ownerB = await makeUser({ role: "owner" });

            await expectAppError(
                service().requireHeadOrAdmin(
                    guardInput(spA.id, { ...ownerB, role: "owner" }),
                ),
                404,
                "space.not_found",
            );
        });
    });

    describe("409 space.archived (outranks the role check)", () => {
        it("rejects an archived space for its head", async () => {
            const owner = await makeUser({ role: "owner" });
            const head = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            const sp = await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                headUserId: head.id,
                createdBy: owner.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });

            await expectAppError(
                service().requireHeadOrAdmin(
                    guardInput(sp.id, { ...head, role: "member" }),
                ),
                409,
                "space.archived",
            );
        });

        it("rejects an archived space even for the owner", async () => {
            const owner = await makeUser({ role: "owner" });
            const sp = await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                createdBy: owner.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });

            await expectAppError(
                service().requireHeadOrAdmin(
                    guardInput(sp.id, { ...owner, role: "owner" }),
                ),
                409,
                "space.archived",
            );
        });
    });

    describe("isHeadOfSpace helper", () => {
        it("is true only for the exact non-null head id", () => {
            expect(isHeadOfSpace("u-1", { headUserId: "u-1" })).toBe(true);
            expect(isHeadOfSpace("u-2", { headUserId: "u-1" })).toBe(false);
            expect(isHeadOfSpace("u-1", { headUserId: null })).toBe(false);
        });
    });
});
