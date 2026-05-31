CREATE TABLE `user_notification_prefs` (
	`user_id` varchar(64) NOT NULL,
	`type` enum('assigned','mentioned','comment','status_change','due_soon','overdue','form_submitted','automation_failed','pr_review','incident_alert') NOT NULL,
	`in_app_enabled` boolean NOT NULL DEFAULT true,
	`email_enabled` boolean NOT NULL DEFAULT true,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_notification_prefs_user_id_type_pk` PRIMARY KEY(`user_id`,`type`)
);
--> statement-breakpoint
ALTER TABLE `attachments` ADD `upload_status` enum('pending','complete') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `user_notification_prefs` ADD CONSTRAINT `user_notification_prefs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;