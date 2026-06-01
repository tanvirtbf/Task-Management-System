CREATE TABLE `task_postmortems` (
	`task_id` varchar(64) NOT NULL,
	`items` json NOT NULL,
	`updated_by` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `task_postmortems_task_id` PRIMARY KEY(`task_id`)
);
--> statement-breakpoint
CREATE TABLE `chat_conversations` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`title` varchar(200) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` varchar(64) NOT NULL,
	`internal_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`conversation_id` varchar(64) NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` mediumtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_chat_messages_internal_id` UNIQUE(`internal_id`)
);
--> statement-breakpoint
ALTER TABLE `task_postmortems` ADD CONSTRAINT `task_postmortems_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_postmortems` ADD CONSTRAINT `task_postmortems_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `chat_conversations` ADD CONSTRAINT `chat_conversations_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `chat_conversations` ADD CONSTRAINT `chat_conversations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `fk_chat_messages_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `idx_chat_conversations_user_time` ON `chat_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_conversation_time` ON `chat_messages` (`conversation_id`,`created_at`);