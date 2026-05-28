DROP TABLE `customers`;--> statement-breakpoint
DROP TABLE `stock_batches`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `type` enum('assigned','mentioned','comment','status_change','due_soon','overdue','form_submitted','automation_failed','pr_review','incident_alert') NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `entity_type` enum('task','comment','form','automation','incident') NOT NULL;