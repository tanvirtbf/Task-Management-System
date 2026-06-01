// =============================================================================
// Chat — AI Help Assistant conversation persistence (2 tables)
//   Mirrors `database/schema.sql`. See AI_ASSISTANT_PLAN.md, Phase 6.
//
// `chat_conversations` is one help-assistant thread owned by a user; its
// `chat_messages` are the user/assistant turns. Both are workspace + user
// scoped — a user only ever reads their own conversations.
// =============================================================================
import {
    bigint,
    foreignKey,
    index,
    mediumtext,
    mysqlEnum,
    mysqlTable,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import { ID_LENGTH } from "./_shared";
import { workspaces, users } from "./auth";

export const chatRoles = ["user", "assistant"] as const;

export const chatConversations = mysqlTable(
    "chat_conversations",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        userId: varchar("user_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        title: varchar("title", { length: 200 }).notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at")
            .notNull()
            .defaultNow()
            .onUpdateNow(),
    },
    (t) => ({
        userTimeIdx: index("idx_chat_conversations_user_time").on(
            t.userId,
            t.updatedAt,
        ),
    }),
);

export const chatMessages = mysqlTable(
    "chat_messages",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        // Monotonic insertion order — TIMESTAMP is only second-precise, so two
        // turns saved in the same second would sort non-deterministically.
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        conversationId: varchar("conversation_id", {
            length: ID_LENGTH,
        }).notNull(),
        role: mysqlEnum("role", chatRoles).notNull(),
        content: mediumtext("content").notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_chat_messages_internal_id").on(
            t.internalId,
        ),
        conversationFk: foreignKey({
            columns: [t.conversationId],
            foreignColumns: [chatConversations.id],
            name: "fk_chat_messages_conversation",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        conversationTimeIdx: index("idx_chat_messages_conversation_time").on(
            t.conversationId,
            t.createdAt,
        ),
    }),
);

export type ChatConversation = typeof chatConversations.$inferSelect;
export type NewChatConversation = typeof chatConversations.$inferInsert;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessageRow = typeof chatMessages.$inferInsert;
