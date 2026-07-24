CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`category` text NOT NULL,
	`note` text NOT NULL,
	`evidence_type` text NOT NULL,
	`confidence` text NOT NULL,
	`panorama_yaw` integer,
	`panorama_pitch` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`display_name` text DEFAULT 'Unnamed participant' NOT NULL,
	`operation_name` text,
	`location` text,
	`contact_preference` text,
	`season_start` text,
	`season_end` text,
	`hive_capacity` integer,
	`hives_needed` integer,
	`crop` text,
	`acres` integer,
	`travel_radius_miles` integer,
	`price_expectation` text,
	`requirements` text,
	`profile_json` text DEFAULT '{}' NOT NULL,
	`transcript_json` text DEFAULT '[]' NOT NULL,
	`interview_status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
