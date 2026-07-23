SET FOREIGN_KEY_CHECKS = 0;--> statement-breakpoint
DROP TABLE IF EXISTS `stock_movements`;--> statement-breakpoint
DROP TABLE IF EXISTS `stock_batches`;--> statement-breakpoint
DROP TABLE IF EXISTS `customers`;--> statement-breakpoint
SET FOREIGN_KEY_CHECKS = 1;--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `type` enum('assigned','mentioned','comment','status_change','due_soon','overdue','form_submitted','automation_failed','pr_review','incident_alert') NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `entity_type` enum('task','comment','form','automation','incident') NOT NULL;
