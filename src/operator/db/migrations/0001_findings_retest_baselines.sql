ALTER TABLE `runs` ADD `validation_closure_json` text;
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`run_db_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`fingerprint` text,
	`promotion_state` text DEFAULT 'run_only' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_db_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_run_idx` ON `findings` (`run_db_id`);
--> statement-breakpoint
CREATE TABLE `retest_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_db_id` text,
	`issue_id` text,
	`patch_proposal_id` text,
	`check_id` text NOT NULL,
	`rationale` text NOT NULL,
	`required` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`waive_reason` text,
	`related_finding_ids_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_db_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patch_proposal_id`) REFERENCES `patch_proposals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retest_items_run` ON `retest_items` (`run_db_id`);
--> statement-breakpoint
CREATE INDEX `retest_items_patch` ON `retest_items` (`patch_proposal_id`);
--> statement-breakpoint
CREATE TABLE `visual_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`baseline_key` text NOT NULL,
	`content_sha256` text NOT NULL,
	`approved_run_db_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visual_baselines_ws_key` ON `visual_baselines` (`workspace_id`,`baseline_key`);
