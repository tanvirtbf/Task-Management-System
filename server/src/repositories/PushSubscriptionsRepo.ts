import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { pushSubscriptions } from "../db/schema";
import type { PushSubscriptionRow } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for `push_subscriptions` (§29c — Web Push devices).
 *
 * The natural key is the push-service `endpoint` URL, but it is far too long
 * for a utf8mb4 unique index, so the table keys on its SHA-256
 * (`endpoint_hash`). ALL hashing lives here, so no caller can compute it
 * differently and silently create a duplicate device row.
 */

const hashEndpoint = (endpoint: string): string =>
    createHash("sha256").update(endpoint, "utf8").digest("hex");

export interface UpsertPushSubscriptionInput {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
}

export class PushSubscriptionsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Register — or refresh — one device subscription.
     *
     * The same endpoint re-subscribing (every sign-in does this) updates the
     * existing row in place. That includes a re-subscribe under a DIFFERENT
     * user on a shared computer: the row is REASSIGNED, so the device delivers
     * to whoever is signed in on it and never to the previous occupant.
     */
    async upsert(
        input: UpsertPushSubscriptionInput,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .insert(pushSubscriptions)
            .values({
                id: fakeId("psub"),
                userId: input.userId,
                endpointHash: hashEndpoint(input.endpoint),
                endpoint: input.endpoint,
                p256dh: input.p256dh,
                auth: input.auth,
                userAgent: input.userAgent ?? null,
            })
            .onDuplicateKeyUpdate({
                set: {
                    userId: input.userId,
                    endpoint: input.endpoint,
                    p256dh: input.p256dh,
                    auth: input.auth,
                    userAgent: input.userAgent ?? null,
                    updatedAt: new Date(),
                },
            });
    }

    /**
     * Drop the caller's subscription for this endpoint (sign-out / opt-out).
     * Scoped to `userId` so one user can never delete another's device row —
     * and an unknown endpoint is an idempotent no-op, never an existence
     * oracle.
     */
    async deleteByEndpointForUser(
        userId: string,
        endpoint: string,
    ): Promise<void> {
        await this.db
            .delete(pushSubscriptions)
            .where(
                and(
                    eq(pushSubscriptions.endpointHash, hashEndpoint(endpoint)),
                    eq(pushSubscriptions.userId, userId),
                ),
            );
    }

    /** Every device subscription of a set of users — the fan-out read. */
    async findByUserIds(userIds: string[]): Promise<PushSubscriptionRow[]> {
        if (userIds.length === 0) return [];
        return this.db
            .select()
            .from(pushSubscriptions)
            .where(inArray(pushSubscriptions.userId, userIds));
    }

    /** One user's devices — the §29c self-service read and test assertions. */
    async findByUserId(userId: string): Promise<PushSubscriptionRow[]> {
        return this.db
            .select()
            .from(pushSubscriptions)
            .where(eq(pushSubscriptions.userId, userId));
    }

    /** Prune a dead device row (the push service answered 404/410). */
    async deleteById(id: string): Promise<void> {
        await this.db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, id));
    }
}
