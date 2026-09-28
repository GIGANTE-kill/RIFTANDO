CREATE TABLE "match_participants" (
	"match_id" text NOT NULL,
	"puuid" text NOT NULL,
	"champion_id" text NOT NULL,
	"role" "lane_role",
	"opponent_champion_id" text,
	"win" boolean NOT NULL,
	"patch" text NOT NULL,
	"queue_id" integer NOT NULL,
	"kills" integer NOT NULL,
	"deaths" integer NOT NULL,
	"assists" integer NOT NULL,
	"cs" integer NOT NULL,
	"gold_earned" integer NOT NULL,
	"items" integer[] DEFAULT '{}' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "match_participants_match_id_puuid_pk" PRIMARY KEY("match_id","puuid")
);
--> statement-breakpoint
CREATE TABLE "riot_accounts" (
	"puuid" text PRIMARY KEY NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"platform" text NOT NULL,
	"profile_icon_id" integer,
	"summoner_level" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riot_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"patch" text NOT NULL,
	"queue_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_sec" integer NOT NULL,
	"bans" text[] DEFAULT '{}' NOT NULL,
	"data" jsonb NOT NULL,
	"timeline" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "champions" ADD COLUMN "positions" "lane_role"[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "champions" ADD COLUMN "official_damage_type" "damage_type";--> statement-breakpoint
ALTER TABLE "champions" ADD COLUMN "difficulty" integer;--> statement-breakpoint
ALTER TABLE "champions" ADD COLUMN "playstyle" jsonb;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_riot_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."riot_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mp_stats_idx" ON "match_participants" USING btree ("patch","queue_id","champion_id","role");--> statement-breakpoint
CREATE INDEX "mp_puuid_idx" ON "match_participants" USING btree ("puuid","started_at");--> statement-breakpoint
CREATE INDEX "riot_matches_patch_queue_idx" ON "riot_matches" USING btree ("patch","queue_id");