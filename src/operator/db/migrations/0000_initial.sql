CREATE TABLE `environment_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`snapshot_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `explain_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_key` text NOT NULL,
	`template_slug` text NOT NULL,
	`inputs_hash` text NOT NULL,
	`rendered_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issue_runs` (
	`issue_id` text NOT NULL,
	`run_db_id` text NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_db_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`title` text NOT NULL,
	`classification` text,
	`code_bridge_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issues_fingerprint` ON `issues` (`workspace_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `patch_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`base_sha` text NOT NULL,
	`unified_diff` text NOT NULL,
	`author_kind` text NOT NULL,
	`state` text NOT NULL,
	`validation_run_ids_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`repo_root` text NOT NULL,
	`adapter_types` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `projects_workspace_slug` ON `projects` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `run_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_db_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`kind` text NOT NULL,
	`sha256` text,
	`bytes` integer,
	`blob_key` text,
	FOREIGN KEY (`run_db_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `run_artifacts_run` ON `run_artifacts` (`run_db_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`environment_profile_id` text,
	`suite_id` text,
	`neoxten_run_id` text NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer NOT NULL,
	`config_path` text NOT NULL,
	`source_run_dir` text NOT NULL,
	`verdict_json` text NOT NULL,
	`manifest_json` text NOT NULL,
	`evidence_timeline_json` text,
	`completed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`failure_fingerprint` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_profile_id`) REFERENCES `environment_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `runs_workspace_completed` ON `runs` (`workspace_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `runs_neoxten_run_id` ON `runs` (`neoxten_run_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
