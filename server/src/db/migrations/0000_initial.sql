CREATE TABLE `invitations` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` enum('admin','member','guest') NOT NULL DEFAULT 'member',
	`token_hash` char(64) NOT NULL,
	`invited_by` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`accepted_by` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_invitations_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_password_reset_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`user_agent` varchar(500),
	`ip_address` varchar(45),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sessions_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`first_name` varchar(80) NOT NULL,
	`last_name` varchar(80) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('owner','admin','member','guest') NOT NULL DEFAULT 'member',
	`avatar_url` varchar(500),
	`status` enum('active','invited','deactivated') NOT NULL DEFAULT 'invited',
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Dhaka',
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_workspace_email` UNIQUE(`workspace_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`logo_url` varchar(500),
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Dhaka',
	`default_locale` varchar(16) NOT NULL DEFAULT 'en-US',
	`week_starts_on` tinyint unsigned NOT NULL DEFAULT 6,
	`working_days` set('sun','mon','tue','wed','thu','fri','sat') NOT NULL DEFAULT 'sun,mon,tue,wed,thu',
	`business_hours_start` time NOT NULL DEFAULT '09:00:00',
	`business_hours_end` time NOT NULL DEFAULT '18:00:00',
	`fiscal_year_start_month` tinyint unsigned NOT NULL DEFAULT 7,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `ck_workspaces_week_starts_on` CHECK(`workspaces`.`week_starts_on` BETWEEN 0 AND 6),
	CONSTRAINT `ck_workspaces_fiscal_month` CHECK(`workspaces`.`fiscal_year_start_month` BETWEEN 1 AND 12),
	CONSTRAINT `ck_workspaces_hours` CHECK(`workspaces`.`business_hours_start` < `workspaces`.`business_hours_end`)
);
--> statement-breakpoint
CREATE TABLE `lists` (
	`id` varchar(64) NOT NULL,
	`space_id` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(500),
	`icon` varchar(64) NOT NULL DEFAULT 'ListChecks',
	`color` char(7) NOT NULL DEFAULT '#4F46E5',
	`position` int unsigned NOT NULL DEFAULT 0,
	`default_task_type_id` varchar(64),
	`is_private` boolean NOT NULL DEFAULT false,
	`archived_at` timestamp,
	`created_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(500),
	`icon` varchar(64) NOT NULL DEFAULT 'Folder',
	`color` char(7) NOT NULL DEFAULT '#4F46E5',
	`is_private` boolean NOT NULL DEFAULT false,
	`position` int unsigned NOT NULL DEFAULT 0,
	`archived_at` timestamp,
	`created_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `spaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `ck_spaces_color` CHECK(`spaces`.`color` REGEXP '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE `statuses` (
	`id` varchar(64) NOT NULL,
	`scope_type` enum('list','space') NOT NULL DEFAULT 'list',
	`scope_id` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`color` char(7) NOT NULL DEFAULT '#94A3B8',
	`status_group` enum('not_started','active','done','closed') NOT NULL,
	`position` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `statuses_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_statuses_scope_name` UNIQUE(`scope_type`,`scope_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`name` varchar(60) NOT NULL,
	`color` char(7) NOT NULL DEFAULT '#94A3B8',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tags_workspace_name` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `task_types` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`description` varchar(300),
	`icon` varchar(64) NOT NULL DEFAULT 'CheckSquare',
	`color` char(7) NOT NULL DEFAULT '#6B7280',
	`is_milestone_type` boolean NOT NULL DEFAULT false,
	`is_system` boolean NOT NULL DEFAULT false,
	`is_dev_type` boolean NOT NULL DEFAULT false,
	`position` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `task_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_task_types_workspace_name` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `on_call_shifts` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`week_start` date NOT NULL,
	`week_end` date NOT NULL,
	`engineer_id` varchar(64) NOT NULL,
	`created_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `on_call_shifts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_on_call_shifts_week` UNIQUE(`workspace_id`,`week_start`),
	CONSTRAINT `ck_on_call_shifts_week` CHECK(`on_call_shifts`.`week_start` <= `on_call_shifts`.`week_end`)
);
--> statement-breakpoint
CREATE TABLE `sprints` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`goal` varchar(300),
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`status` enum('planned','active','closed') NOT NULL DEFAULT 'planned',
	`committed_points` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sprints_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sprints_workspace_name` UNIQUE(`workspace_id`,`name`),
	CONSTRAINT `ck_sprints_dates` CHECK(`sprints`.`start_date` <= `sprints`.`end_date`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`name` varchar(160) NOT NULL,
	`default_address` varchar(500),
	`total_orders` int unsigned NOT NULL DEFAULT 0,
	`total_complaints` int unsigned NOT NULL DEFAULT 0,
	`lifetime_value` bigint unsigned NOT NULL DEFAULT 0,
	`vip_flag` boolean GENERATED ALWAYS AS ((total_orders >= 5 OR lifetime_value >= 1000000)) STORED NOT NULL,
	`last_order_at` timestamp,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customers_workspace_phone` UNIQUE(`workspace_id`,`phone`),
	CONSTRAINT `ck_customers_phone` CHECK(`customers`.`phone` REGEXP '^01[3-9][0-9]{8}$')
);
--> statement-breakpoint
CREATE TABLE `task_activity` (
	`id` varchar(64) NOT NULL,
	`internal_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`actor_id` varchar(64),
	`action` varchar(60) NOT NULL,
	`context` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_activity_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_task_activity_internal_id` UNIQUE(`internal_id`)
);
--> statement-breakpoint
CREATE TABLE `task_assignees` (
	`task_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`assigned_at` timestamp NOT NULL DEFAULT (now()),
	`assigned_by` varchar(64),
	CONSTRAINT `task_assignees_task_id_user_id_pk` PRIMARY KEY(`task_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` varchar(64) NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`related_task_id` varchar(64) NOT NULL,
	`dep_type` enum('blocks') NOT NULL DEFAULT 'blocks',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(64) NOT NULL,
	CONSTRAINT `task_dependencies_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_task_dependencies` UNIQUE(`task_id`,`related_task_id`,`dep_type`)
);
--> statement-breakpoint
CREATE TABLE `task_tags` (
	`task_id` varchar(64) NOT NULL,
	`tag_id` varchar(64) NOT NULL,
	`added_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_tags_task_id_tag_id_pk` PRIMARY KEY(`task_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `task_watchers` (
	`task_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_watchers_task_id_user_id_pk` PRIMARY KEY(`task_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` varchar(64) NOT NULL,
	`internal_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`primary_list_id` varchar(64) NOT NULL,
	`task_number` int unsigned NOT NULL,
	`custom_id` varchar(40),
	`name` varchar(500) NOT NULL,
	`description` mediumtext,
	`status_id` varchar(64) NOT NULL,
	`priority` tinyint unsigned NOT NULL DEFAULT 0,
	`task_type_id` varchar(64) NOT NULL,
	`parent_task_id` varchar(64),
	`nesting_depth` tinyint unsigned NOT NULL DEFAULT 0,
	`is_milestone` boolean NOT NULL DEFAULT false,
	`start_date` date,
	`due_date` date,
	`completed_at` timestamp,
	`sla_due_at` timestamp,
	`recurrence_pattern` enum('none','daily','weekly') NOT NULL DEFAULT 'none',
	`recurrence_days` set('sun','mon','tue','wed','thu','fri','sat'),
	`recurrence_ends_at` date,
	`time_estimate_seconds` int unsigned,
	`time_tracked_seconds` int unsigned NOT NULL DEFAULT 0,
	`subtasks_count` int unsigned NOT NULL DEFAULT 0,
	`subtasks_completed` int unsigned NOT NULL DEFAULT 0,
	`comments_count` int unsigned NOT NULL DEFAULT 0,
	`attachments_count` int unsigned NOT NULL DEFAULT 0,
	`sprint_id` varchar(64),
	`story_points` tinyint unsigned,
	`reviewer_id` varchar(64),
	`branch_name` varchar(200),
	`pr_url` varchar(500),
	`pr_status` enum('open','merged','closed','draft'),
	`bug_severity` enum('S0','S1','S2','S3'),
	`bug_reproducibility` enum('always','sometimes','once','cannot'),
	`bug_environment` enum('production','staging','local'),
	`bug_browser` varchar(120),
	`reporter_team` enum('ops','cs','inventory','listing','marketing','internal'),
	`deployed_at` timestamp,
	`rollback_reason` varchar(500),
	`archived_at` timestamp,
	`created_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tasks_internal_id` UNIQUE(`internal_id`),
	CONSTRAINT `uq_tasks_custom_id` UNIQUE(`workspace_id`,`custom_id`),
	CONSTRAINT `uq_tasks_list_number` UNIQUE(`primary_list_id`,`task_number`),
	CONSTRAINT `ck_tasks_priority` CHECK(`tasks`.`priority` BETWEEN 0 AND 4),
	CONSTRAINT `ck_tasks_nesting` CHECK(`tasks`.`nesting_depth` <= 2),
	CONSTRAINT `ck_tasks_dates` CHECK(`tasks`.`start_date` IS NULL OR `tasks`.`due_date` IS NULL OR `tasks`.`start_date` <= `tasks`.`due_date`)
);
--> statement-breakpoint
CREATE TABLE `stock_batches` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`sku_task_id` varchar(64) NOT NULL,
	`batch_number` varchar(80) NOT NULL,
	`mfg_date` varchar(10),
	`expiry_date` varchar(10),
	`quantity_received` int unsigned NOT NULL,
	`quantity_remaining` int NOT NULL DEFAULT 0,
	`cost_per_unit_paisa` bigint unsigned,
	`supplier_name` varchar(200),
	`received_via_task_id` varchar(64),
	`received_at` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stock_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_batches_sku_batch` UNIQUE(`sku_task_id`,`batch_number`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` varchar(64) NOT NULL,
	`internal_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`sku_task_id` varchar(64) NOT NULL,
	`batch_id` varchar(64),
	`movement_type` enum('receive','sale','return','damage','adjustment','transfer','reversal') NOT NULL,
	`quantity_change` int NOT NULL,
	`reason` varchar(300),
	`related_task_id` varchar(64),
	`actor_id` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_movements_internal_id` UNIQUE(`internal_id`)
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` varchar(64) NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`storage_key` varchar(500) NOT NULL,
	`mime_type` varchar(120) NOT NULL DEFAULT 'application/octet-stream',
	`size_bytes` bigint unsigned NOT NULL,
	`thumbnail_key` varchar(500),
	`uploaded_by` varchar(64) NOT NULL,
	`uploaded_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `checklist_items` (
	`id` varchar(64) NOT NULL,
	`checklist_id` varchar(64) NOT NULL,
	`parent_item_id` varchar(64),
	`text` varchar(500) NOT NULL,
	`is_completed` boolean NOT NULL DEFAULT false,
	`completed_at` timestamp,
	`completed_by` varchar(64),
	`assignee_id` varchar(64),
	`position` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `checklist_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `checklists` (
	`id` varchar(64) NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`name` varchar(200) NOT NULL,
	`position` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `checklists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` varchar(64) NOT NULL,
	`internal_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`parent_comment_id` varchar(64),
	`author_id` varchar(64) NOT NULL,
	`body` text NOT NULL,
	`edited_at` timestamp,
	`deleted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comments_internal_id` UNIQUE(`internal_id`)
);
--> statement-breakpoint
CREATE TABLE `custom_field_options` (
	`id` varchar(64) NOT NULL,
	`custom_field_id` varchar(64) NOT NULL,
	`label` varchar(120) NOT NULL,
	`color` char(7) NOT NULL DEFAULT '#94A3B8',
	`position` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `custom_field_options_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cf_options_field_label` UNIQUE(`custom_field_id`,`label`)
);
--> statement-breakpoint
CREATE TABLE `custom_fields` (
	`id` varchar(64) NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`scope_type` enum('workspace','space','list') NOT NULL,
	`scope_id` varchar(64),
	`name` varchar(120) NOT NULL,
	`type` enum('text','phone','money','date','dropdown','files') NOT NULL,
	`config` json NOT NULL DEFAULT ('{}'),
	`is_required` boolean NOT NULL DEFAULT false,
	`default_value` json,
	`position` int unsigned NOT NULL DEFAULT 0,
	`hidden_from_guests` boolean NOT NULL DEFAULT false,
	`created_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `custom_fields_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_custom_field_values` (
	`task_id` varchar(64) NOT NULL,
	`custom_field_id` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`updated_by` varchar(64),
	`option_id_generated` varchar(64) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(value, '$.option_id'))) VIRTUAL,
	CONSTRAINT `task_custom_field_values_task_id_custom_field_id_pk` PRIMARY KEY(`task_id`,`custom_field_id`)
);
--> statement-breakpoint
CREATE TABLE `form_fields` (
	`id` varchar(64) NOT NULL,
	`form_id` varchar(64) NOT NULL,
	`field_kind` enum('task_attr','custom_field') NOT NULL,
	`field_key` varchar(120) NOT NULL,
	`label` varchar(200) NOT NULL,
	`help_text` varchar(500),
	`placeholder` varchar(200),
	`is_required` boolean NOT NULL DEFAULT false,
	`is_hidden` boolean NOT NULL DEFAULT false,
	`default_value` json,
	`position` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `form_fields_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_form_fields_form_key` UNIQUE(`form_id`,`field_kind`,`field_key`)
);
--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` varchar(64) NOT NULL,
	`internal_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`form_id` varchar(64) NOT NULL,
	`task_id` varchar(64),
	`submitter_email` varchar(255),
	`submitter_ip` varchar(45),
	`data` json NOT NULL,
	`submitted_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `form_submissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_form_submissions_internal_id` UNIQUE(`internal_id`)
);
--> statement-breakpoint
CREATE TABLE `forms` (
	`id` varchar(64) NOT NULL,
	`list_id` varchar(64) NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` varchar(2000),
	`is_public` boolean NOT NULL DEFAULT true,
	`public_slug` varchar(120) NOT NULL,
	`branding` json NOT NULL DEFAULT ('{}'),
	`settings` json NOT NULL DEFAULT ('{}'),
	`submission_count` int unsigned NOT NULL DEFAULT 0,
	`created_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `forms_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_forms_public_slug` UNIQUE(`public_slug`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(64) NOT NULL,
	`internal_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`type` enum('assigned','mentioned','comment','status_change','due_soon','overdue','form_submitted','automation_failed','reminder_due','pr_review','incident_alert') NOT NULL,
	`entity_type` enum('task','comment','form','reminder','automation','incident') NOT NULL,
	`entity_id` varchar(64) NOT NULL,
	`actor_id` varchar(64),
	`title` varchar(300) NOT NULL,
	`body` varchar(1000),
	`is_read` boolean NOT NULL DEFAULT false,
	`snoozed_until` timestamp,
	`email_sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_notifications_internal_id` UNIQUE(`internal_id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_activity` (
	`id` varchar(64) NOT NULL,
	`internal_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` varchar(64) NOT NULL,
	`actor_id` varchar(64),
	`entity_type` enum('workspace','space','list','task_type','tag','custom_field','user','role','sprint') NOT NULL,
	`entity_id` varchar(64) NOT NULL,
	`action` varchar(60) NOT NULL,
	`context` json,
	`ip_address` varchar(45),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workspace_activity_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_workspace_activity_internal_id` UNIQUE(`internal_id`)
);
--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `fk_invitations_invited_by` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `fk_invitations_accepted_by` FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lists` ADD CONSTRAINT `lists_space_id_spaces_id_fk` FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lists` ADD CONSTRAINT `fk_lists_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lists` ADD CONSTRAINT `fk_lists_default_task_type` FOREIGN KEY (`default_task_type_id`) REFERENCES `task_types`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `spaces` ADD CONSTRAINT `spaces_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `spaces` ADD CONSTRAINT `fk_spaces_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tags` ADD CONSTRAINT `tags_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_types` ADD CONSTRAINT `task_types_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `on_call_shifts` ADD CONSTRAINT `on_call_shifts_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `on_call_shifts` ADD CONSTRAINT `fk_on_call_shifts_engineer` FOREIGN KEY (`engineer_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `on_call_shifts` ADD CONSTRAINT `fk_on_call_shifts_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `sprints` ADD CONSTRAINT `sprints_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_activity` ADD CONSTRAINT `task_activity_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_activity` ADD CONSTRAINT `fk_task_activity_actor` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_assignees` ADD CONSTRAINT `task_assignees_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_assignees` ADD CONSTRAINT `task_assignees_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_assignees` ADD CONSTRAINT `fk_task_assignees_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_related_task_id_tasks_id_fk` FOREIGN KEY (`related_task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `fk_task_dependencies_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_tags` ADD CONSTRAINT `task_tags_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_tags` ADD CONSTRAINT `task_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_watchers` ADD CONSTRAINT `task_watchers_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_watchers` ADD CONSTRAINT `task_watchers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_primary_list_id_lists_id_fk` FOREIGN KEY (`primary_list_id`) REFERENCES `lists`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_status_id_statuses_id_fk` FOREIGN KEY (`status_id`) REFERENCES `statuses`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_task_type_id_task_types_id_fk` FOREIGN KEY (`task_type_id`) REFERENCES `task_types`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `fk_tasks_parent` FOREIGN KEY (`parent_task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `fk_tasks_sprint` FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `fk_tasks_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `fk_tasks_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_batches` ADD CONSTRAINT `stock_batches_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_batches` ADD CONSTRAINT `stock_batches_sku_task_id_tasks_id_fk` FOREIGN KEY (`sku_task_id`) REFERENCES `tasks`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_batches` ADD CONSTRAINT `fk_stock_batches_received_via` FOREIGN KEY (`received_via_task_id`) REFERENCES `tasks`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_sku_task_id_tasks_id_fk` FOREIGN KEY (`sku_task_id`) REFERENCES `tasks`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_batch_id_stock_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `stock_batches`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movements_task` FOREIGN KEY (`related_task_id`) REFERENCES `tasks`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movements_actor` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `checklist_items` ADD CONSTRAINT `checklist_items_checklist_id_checklists_id_fk` FOREIGN KEY (`checklist_id`) REFERENCES `checklists`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `checklist_items` ADD CONSTRAINT `fk_checklist_items_parent` FOREIGN KEY (`parent_item_id`) REFERENCES `checklist_items`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `checklist_items` ADD CONSTRAINT `fk_checklist_items_assignee` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `checklist_items` ADD CONSTRAINT `fk_checklist_items_completed_by` FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `checklists` ADD CONSTRAINT `checklists_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `fk_comments_parent` FOREIGN KEY (`parent_comment_id`) REFERENCES `comments`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `custom_field_options` ADD CONSTRAINT `custom_field_options_custom_field_id_custom_fields_id_fk` FOREIGN KEY (`custom_field_id`) REFERENCES `custom_fields`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `custom_fields` ADD CONSTRAINT `custom_fields_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `custom_fields` ADD CONSTRAINT `fk_custom_fields_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_custom_field_values` ADD CONSTRAINT `task_custom_field_values_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_custom_field_values` ADD CONSTRAINT `task_custom_field_values_custom_field_id_custom_fields_id_fk` FOREIGN KEY (`custom_field_id`) REFERENCES `custom_fields`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `task_custom_field_values` ADD CONSTRAINT `fk_tcfv_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `form_fields` ADD CONSTRAINT `form_fields_form_id_forms_id_fk` FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD CONSTRAINT `form_submissions_form_id_forms_id_fk` FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD CONSTRAINT `fk_form_submissions_task` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `forms` ADD CONSTRAINT `forms_list_id_lists_id_fk` FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `forms` ADD CONSTRAINT `fk_forms_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `fk_notifications_actor` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `workspace_activity` ADD CONSTRAINT `workspace_activity_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `workspace_activity` ADD CONSTRAINT `fk_workspace_activity_actor` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `idx_invitations_workspace_email` ON `invitations` (`workspace_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_invitations_expires` ON `invitations` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_password_reset_user` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_password_reset_expires` ON `password_reset_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_active` ON `sessions` (`user_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_users_workspace_status` ON `users` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_lists_space_archived` ON `lists` (`space_id`,`archived_at`,`position`);--> statement-breakpoint
CREATE INDEX `idx_lists_default_task_type` ON `lists` (`default_task_type_id`);--> statement-breakpoint
CREATE INDEX `idx_spaces_workspace_archived` ON `spaces` (`workspace_id`,`archived_at`,`position`);--> statement-breakpoint
CREATE INDEX `idx_statuses_scope` ON `statuses` (`scope_type`,`scope_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_statuses_group` ON `statuses` (`status_group`);--> statement-breakpoint
CREATE INDEX `idx_task_types_workspace` ON `task_types` (`workspace_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_on_call_shifts_engineer` ON `on_call_shifts` (`engineer_id`,`week_start`);--> statement-breakpoint
CREATE INDEX `idx_sprints_workspace_status` ON `sprints` (`workspace_id`,`status`,`start_date`);--> statement-breakpoint
CREATE INDEX `idx_customers_workspace_vip` ON `customers` (`workspace_id`,`vip_flag`,`last_order_at`);--> statement-breakpoint
CREATE INDEX `idx_customers_phone` ON `customers` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_task_activity_task_time` ON `task_activity` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_task_assignees_user` ON `task_assignees` (`user_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_dependencies_related` ON `task_dependencies` (`related_task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_tags_tag` ON `task_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_task_watchers_user` ON `task_watchers` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_list_active` ON `tasks` (`primary_list_id`,`archived_at`,`status_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_tasks_sprint` ON `tasks` (`sprint_id`,`status_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_reviewer` ON `tasks` (`reviewer_id`,`pr_status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status_updated` ON `tasks` (`status_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_tasks_custom_id` ON `tasks` (`custom_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_parent` ON `tasks` (`parent_task_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_severity` ON `tasks` (`bug_severity`,`status_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_recurrence` ON `tasks` (`recurrence_pattern`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_tasks_sla` ON `tasks` (`sla_due_at`,`completed_at`,`archived_at`);--> statement-breakpoint
CREATE INDEX `idx_stock_batches_sku_expiry` ON `stock_batches` (`sku_task_id`,`expiry_date`);--> statement-breakpoint
CREATE INDEX `idx_stock_batches_expiry` ON `stock_batches` (`workspace_id`,`expiry_date`);--> statement-breakpoint
CREATE INDEX `idx_stock_batches_received_via` ON `stock_batches` (`received_via_task_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_sku_time` ON `stock_movements` (`sku_task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_task` ON `stock_movements` (`related_task_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_batch` ON `stock_movements` (`batch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_workspace_time` ON `stock_movements` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_attachments_task` ON `attachments` (`task_id`,`uploaded_at`);--> statement-breakpoint
CREATE INDEX `idx_checklist_items_checklist` ON `checklist_items` (`checklist_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_checklist_items_assignee` ON `checklist_items` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_checklists_task` ON `checklists` (`task_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_comments_task_time` ON `comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_parent` ON `comments` (`parent_comment_id`);--> statement-breakpoint
CREATE INDEX `idx_cf_options_field` ON `custom_field_options` (`custom_field_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_custom_fields_scope` ON `custom_fields` (`scope_type`,`scope_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_custom_fields_workspace` ON `custom_fields` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_tcfv_field` ON `task_custom_field_values` (`custom_field_id`);--> statement-breakpoint
CREATE INDEX `idx_tcfv_option` ON `task_custom_field_values` (`custom_field_id`,`option_id_generated`);--> statement-breakpoint
CREATE INDEX `idx_form_fields_form` ON `form_fields` (`form_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_form_submissions_form_time` ON `form_submissions` (`form_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `idx_forms_list` ON `forms` (`list_id`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_state` ON `notifications` (`user_id`,`is_read`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_snoozed` ON `notifications` (`snoozed_until`);--> statement-breakpoint
CREATE INDEX `idx_workspace_activity_workspace_time` ON `workspace_activity` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_workspace_activity_entity` ON `workspace_activity` (`entity_type`,`entity_id`);