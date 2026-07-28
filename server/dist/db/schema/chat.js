"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatMessages = exports.chatConversations = exports.chatRoles = void 0;
// =============================================================================
// Chat — AI Help Assistant conversation persistence (2 tables)
//   Mirrors `database/schema.sql`. See AI_ASSISTANT_PLAN.md, Phase 6.
//
// `chat_conversations` is one help-assistant thread owned by a user; its
// `chat_messages` are the user/assistant turns. Both are workspace + user
// scoped — a user only ever reads their own conversations.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
exports.chatRoles = ["user", "assistant"];
exports.chatConversations = (0, mysql_core_1.mysqlTable)("chat_conversations", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    title: (0, mysql_core_1.varchar)("title", { length: 200 }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at")
        .notNull()
        .defaultNow()
        .onUpdateNow(),
}, (t) => ({
    userTimeIdx: (0, mysql_core_1.index)("idx_chat_conversations_user_time").on(t.userId, t.updatedAt),
}));
exports.chatMessages = (0, mysql_core_1.mysqlTable)("chat_messages", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    // Monotonic insertion order — TIMESTAMP is only second-precise, so two
    // turns saved in the same second would sort non-deterministically.
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    conversationId: (0, mysql_core_1.varchar)("conversation_id", {
        length: _shared_1.ID_LENGTH,
    }).notNull(),
    role: (0, mysql_core_1.mysqlEnum)("role", exports.chatRoles).notNull(),
    content: (0, mysql_core_1.mediumtext)("content").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_chat_messages_internal_id").on(t.internalId),
    conversationFk: (0, mysql_core_1.foreignKey)({
        columns: [t.conversationId],
        foreignColumns: [exports.chatConversations.id],
        name: "fk_chat_messages_conversation",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    conversationTimeIdx: (0, mysql_core_1.index)("idx_chat_messages_conversation_time").on(t.conversationId, t.createdAt),
}));
