"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
class ChatRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Create a new conversation; returns its generated id. */
    async createConversation(workspaceId, userId, title, exec = this.db) {
        const id = (0, utils_1.fakeId)("conv");
        await exec
            .insert(schema_1.chatConversations)
            .values({ id, workspaceId, userId, title });
        return id;
    }
    /**
     * Resolve a conversation owned by `userId`. Returns `null` when the id does
     * not exist OR belongs to another user — so a caller can never read or
     * append to someone else's thread.
     */
    async findConversation(id, userId, exec = this.db) {
        const [row] = await exec
            .select({
            id: schema_1.chatConversations.id,
            title: schema_1.chatConversations.title,
            createdAt: schema_1.chatConversations.createdAt,
            updatedAt: schema_1.chatConversations.updatedAt,
        })
            .from(schema_1.chatConversations)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chatConversations.id, id), (0, drizzle_orm_1.eq)(schema_1.chatConversations.userId, userId)))
            .limit(1);
        return row ?? null;
    }
    /** Append a message to a conversation. */
    async addMessage(conversationId, role, content, exec = this.db) {
        await exec.insert(schema_1.chatMessages).values({
            id: (0, utils_1.fakeId)("cmsg"),
            conversationId,
            role,
            content,
        });
    }
    /** Bump a conversation's `updated_at` so recent threads sort first. */
    async touchConversation(id, exec = this.db) {
        await exec
            .update(schema_1.chatConversations)
            .set({ updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.chatConversations.id, id));
    }
    /** The caller's conversations, most-recently-updated first. */
    async listConversationsByUser(userId, limit = 50) {
        return this.db
            .select({
            id: schema_1.chatConversations.id,
            title: schema_1.chatConversations.title,
            createdAt: schema_1.chatConversations.createdAt,
            updatedAt: schema_1.chatConversations.updatedAt,
        })
            .from(schema_1.chatConversations)
            .where((0, drizzle_orm_1.eq)(schema_1.chatConversations.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.chatConversations.updatedAt))
            .limit(limit);
    }
    /**
     * All messages in a conversation, oldest first. Ownership MUST be checked by
     * the caller (via `findConversation`) before calling this.
     */
    async getMessages(conversationId) {
        return this.db
            .select({
            id: schema_1.chatMessages.id,
            role: schema_1.chatMessages.role,
            content: schema_1.chatMessages.content,
            createdAt: schema_1.chatMessages.createdAt,
        })
            .from(schema_1.chatMessages)
            .where((0, drizzle_orm_1.eq)(schema_1.chatMessages.conversationId, conversationId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.chatMessages.internalId));
    }
}
exports.ChatRepo = ChatRepo;
