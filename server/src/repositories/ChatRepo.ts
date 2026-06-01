import { and, asc, desc, eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { chatConversations, chatMessages } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for the AI Help Assistant's persisted conversations
 * (see AI_ASSISTANT_PLAN.md, Phase 6). Every read is user-scoped — a caller can
 * only ever resolve / list their OWN conversations.
 */

export interface ConversationSummary {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface StoredChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: Date;
}

export class ChatRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Create a new conversation; returns its generated id. */
    async createConversation(
        workspaceId: string,
        userId: string,
        title: string,
        exec: DbExecutor = this.db,
    ): Promise<string> {
        const id = fakeId("conv");
        await exec
            .insert(chatConversations)
            .values({ id, workspaceId, userId, title });
        return id;
    }

    /**
     * Resolve a conversation owned by `userId`. Returns `null` when the id does
     * not exist OR belongs to another user — so a caller can never read or
     * append to someone else's thread.
     */
    async findConversation(
        id: string,
        userId: string,
        exec: DbExecutor = this.db,
    ): Promise<ConversationSummary | null> {
        const [row] = await exec
            .select({
                id: chatConversations.id,
                title: chatConversations.title,
                createdAt: chatConversations.createdAt,
                updatedAt: chatConversations.updatedAt,
            })
            .from(chatConversations)
            .where(
                and(
                    eq(chatConversations.id, id),
                    eq(chatConversations.userId, userId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /** Append a message to a conversation. */
    async addMessage(
        conversationId: string,
        role: "user" | "assistant",
        content: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(chatMessages).values({
            id: fakeId("cmsg"),
            conversationId,
            role,
            content,
        });
    }

    /** Bump a conversation's `updated_at` so recent threads sort first. */
    async touchConversation(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(chatConversations)
            .set({ updatedAt: new Date() })
            .where(eq(chatConversations.id, id));
    }

    /** The caller's conversations, most-recently-updated first. */
    async listConversationsByUser(
        userId: string,
        limit = 50,
    ): Promise<ConversationSummary[]> {
        return this.db
            .select({
                id: chatConversations.id,
                title: chatConversations.title,
                createdAt: chatConversations.createdAt,
                updatedAt: chatConversations.updatedAt,
            })
            .from(chatConversations)
            .where(eq(chatConversations.userId, userId))
            .orderBy(desc(chatConversations.updatedAt))
            .limit(limit);
    }

    /**
     * All messages in a conversation, oldest first. Ownership MUST be checked by
     * the caller (via `findConversation`) before calling this.
     */
    async getMessages(conversationId: string): Promise<StoredChatMessage[]> {
        return this.db
            .select({
                id: chatMessages.id,
                role: chatMessages.role,
                content: chatMessages.content,
                createdAt: chatMessages.createdAt,
            })
            .from(chatMessages)
            .where(eq(chatMessages.conversationId, conversationId))
            .orderBy(asc(chatMessages.internalId));
    }
}
