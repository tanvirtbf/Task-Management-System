// =============================================================================
// Chat — AI Help Assistant conversation persistence (2 tables)
//   Mirrors `database/schema.sql`. See AI_ASSISTANT_PLAN.md, Phase 6.
//
// `chat_conversations` is one help-assistant thread owned by a user; its
// `chat_messages` are the user/assistant turns. Both are workspace + user
// scoped — a user only ever reads their own conversations.
// =============================================================================
import {
    foreignKey,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { NOW_MS, timestampMs } from "./_shared";
import { workspaces, users } from "./auth";

export const chatRoles = ["user", "assistant"] as const;

export const chatConversations = sqliteTable(
    "chat_conversations",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        title: text("title").notNull(),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
    },
    (t) => ({
        userTimeIdx: index("idx_chat_conversations_user_time").on(
            t.userId,
            t.updatedAt,
        ),
    }),
);

export const chatMessages = sqliteTable(
    "chat_messages",
    {
        // conv: AUTO_INCREMENT flip — SQLite only auto-increments INTEGER
        // PRIMARY KEY, so `internal_id` became the PK and the public varchar
        // `id` was demoted to NOT NULL UNIQUE.
        id: text("id").notNull().unique(),
        // Monotonic insertion order — TIMESTAMP is only second-precise, so two
        // turns saved in the same second would sort non-deterministically.
        internalId: integer("internal_id", { mode: "number" }).primaryKey({
            autoIncrement: true,
        }),
        conversationId: text("conversation_id").notNull(),
        role: text("role", { enum: chatRoles }).notNull(),
        content: text("content").notNull(),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
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
