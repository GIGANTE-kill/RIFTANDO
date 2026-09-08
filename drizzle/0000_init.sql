CREATE TYPE "public"."attack_type" AS ENUM('MELEE', 'RANGED');--> statement-breakpoint
CREATE TYPE "public"."damage_type" AS ENUM('PHYSICAL', 'MAGIC', 'TRUE', 'MIXED', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."lane_role" AS ENUM('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT');--> statement-breakpoint
CREATE TYPE "public"."tag_category" AS ENUM('DAMAGE_PROFILE', 'RANGE', 'CROWD_CONTROL', 'MOBILITY', 'SUSTAIN', 'PATTERN', 'DEFENSE', 'ITEM_EFFECT');--> statement-breakpoint
CREATE TYPE "public"."tag_source" AS ENUM('derived', 'manual');--> statement-breakpoint
CREATE TYPE "public"."rule_phase" AS ENUM('EARLY', 'MID', 'LATE', 'ANY');--> statement-breakpoint
CREATE TABLE "patches" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"released_at" timestamp with time zone,
	"is_current" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patches_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"patch_id" integer,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"changed_rows" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "champion_patch_stats" (
	"champion_id" text NOT NULL,
	"patch_id" integer NOT NULL,
	"hp" real DEFAULT 0 NOT NULL,
	"hp_per_level" real DEFAULT 0 NOT NULL,
	"armor" real DEFAULT 0 NOT NULL,
	"armor_per_level" real DEFAULT 0 NOT NULL,
	"magic_resist" real DEFAULT 0 NOT NULL,
	"mr_per_level" real DEFAULT 0 NOT NULL,
	"attack_damage" real DEFAULT 0 NOT NULL,
	"ad_per_level" real DEFAULT 0 NOT NULL,
	"attack_speed" real DEFAULT 0 NOT NULL,
	"move_speed" real DEFAULT 0 NOT NULL,
	"attack_range" real DEFAULT 0 NOT NULL,
	"abilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "champion_patch_stats_champion_id_patch_id_pk" PRIMARY KEY("champion_id","patch_id")
);
--> statement-breakpoint
CREATE TABLE "champions" (
	"id" text PRIMARY KEY NOT NULL,
	"riot_id" integer NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"attack_type" "attack_type" NOT NULL,
	"resource" text,
	"classes" text[] DEFAULT '{}' NOT NULL,
	"primary_roles" "lane_role"[] DEFAULT '{}' NOT NULL,
	"icon_url" text,
	"splash_url" text
);
--> statement-breakpoint
CREATE TABLE "item_patch_stats" (
	"item_id" integer NOT NULL,
	"patch_id" integer NOT NULL,
	"total_gold" integer DEFAULT 0 NOT NULL,
	"health" real DEFAULT 0 NOT NULL,
	"armor" real DEFAULT 0 NOT NULL,
	"magic_resist" real DEFAULT 0 NOT NULL,
	"attack_damage" real DEFAULT 0 NOT NULL,
	"ability_power" real DEFAULT 0 NOT NULL,
	"attack_speed" real DEFAULT 0 NOT NULL,
	"critical_chance" real DEFAULT 0 NOT NULL,
	"lifesteal" real DEFAULT 0 NOT NULL,
	"omnivamp" real DEFAULT 0 NOT NULL,
	"ability_haste" real DEFAULT 0 NOT NULL,
	"move_speed" real DEFAULT 0 NOT NULL,
	"tenacity" real DEFAULT 0 NOT NULL,
	"armor_pen" real DEFAULT 0 NOT NULL,
	"magic_pen" real DEFAULT 0 NOT NULL,
	"heal_and_shield_power" real DEFAULT 0 NOT NULL,
	"passive_text" text,
	"raw" jsonb NOT NULL,
	CONSTRAINT "item_patch_stats_item_id_patch_id_pk" PRIMARY KEY("item_id","patch_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"builds_from" integer[] DEFAULT '{}' NOT NULL,
	"builds_into" integer[] DEFAULT '{}' NOT NULL,
	"is_legendary" boolean DEFAULT false NOT NULL,
	"is_purchasable" boolean DEFAULT true NOT NULL,
	"required_champion" text,
	"icon_url" text
);
--> statement-breakpoint
CREATE TABLE "champion_tags" (
	"champion_id" text NOT NULL,
	"tag_id" integer NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"source" "tag_source" DEFAULT 'derived' NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "champion_tags_champion_id_tag_id_pk" PRIMARY KEY("champion_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "item_tags" (
	"item_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"source" "tag_source" DEFAULT 'derived' NOT NULL,
	CONSTRAINT "item_tags_item_id_tag_id_pk" PRIMARY KEY("item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"category" "tag_category" NOT NULL,
	"label" text NOT NULL,
	"description" text,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "champion_matchup_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"self_champion_id" text NOT NULL,
	"enemy_champion_id" text NOT NULL,
	"advantage" integer NOT NULL,
	"guideline" text NOT NULL,
	CONSTRAINT "champion_matchup_uq" UNIQUE("self_champion_id","enemy_champion_id")
);
--> statement-breakpoint
CREATE TABLE "counter_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"condition" jsonb NOT NULL,
	"recommend_tag_slugs" text[] DEFAULT '{}' NOT NULL,
	"recommend_item_ids" integer[] DEFAULT '{}' NOT NULL,
	"exclude_item_ids" integer[] DEFAULT '{}' NOT NULL,
	"explanation" text NOT NULL,
	"phase" "rule_phase" DEFAULT 'ANY' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "counter_rules_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "matchup_tag_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"self_tag_slug" text NOT NULL,
	"enemy_tag_slug" text NOT NULL,
	"advantage" integer NOT NULL,
	"guideline" text NOT NULL,
	"phase" "rule_phase" DEFAULT 'EARLY' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "matchup_tag_pair_uq" UNIQUE("self_tag_slug","enemy_tag_slug","phase")
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champion_patch_stats" ADD CONSTRAINT "champion_patch_stats_champion_id_champions_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."champions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champion_patch_stats" ADD CONSTRAINT "champion_patch_stats_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_patch_stats" ADD CONSTRAINT "item_patch_stats_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_patch_stats" ADD CONSTRAINT "item_patch_stats_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champion_tags" ADD CONSTRAINT "champion_tags_champion_id_champions_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."champions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champion_tags" ADD CONSTRAINT "champion_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patches_current_idx" ON "patches" USING btree ("is_current");--> statement-breakpoint
CREATE INDEX "cps_patch_idx" ON "champion_patch_stats" USING btree ("patch_id");--> statement-breakpoint
CREATE INDEX "ips_patch_idx" ON "item_patch_stats" USING btree ("patch_id");--> statement-breakpoint
CREATE INDEX "champion_tags_tag_idx" ON "champion_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "item_tags_tag_idx" ON "item_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "counter_rules_priority_idx" ON "counter_rules" USING btree ("priority");