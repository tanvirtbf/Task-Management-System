CREATE TABLE `templates` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`type` enum('task','list','space') NOT NULL DEFAULT 'task',
	`name` varchar(120) NOT NULL,
	`description` text,
	`icon` varchar(60),
	`color` char(7),
	`structure` json NOT NULL,
	`usage_count` int unsigned NOT NULL DEFAULT 0,
	`created_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_templates_workspace_name` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `templates` ADD CONSTRAINT `templates_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `templates` ADD CONSTRAINT `fk_templates_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `idx_templates_workspace_type` ON `templates` (`workspace_id`,`type`);