CREATE TABLE "animations" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"image" text,
	"frame_data" text,
	"derive_from" text,
	"reverse" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "app_config_id_check" CHECK ("app_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "battle_map_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"tile_width" double precision,
	"tile_height_ratio" double precision,
	"scale" double precision,
	"rotation" double precision,
	"rotation_x" double precision DEFAULT 0 NOT NULL,
	"rotation_y" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "map_config_id_check" CHECK ("battle_map_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "battle_rewards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"effect" text DEFAULT 'atkPercent' NOT NULL,
	"effect_value" double precision DEFAULT 10 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"wave_count" integer DEFAULT 1 NOT NULL,
	"monster_pool" text DEFAULT '[]' NOT NULL,
	"is_active" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_animations" (
	"character_id" text NOT NULL,
	"animation_key" text NOT NULL,
	"duration" double precision,
	"loop" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "character_animations_character_id_animation_key_pk" PRIMARY KEY("character_id","animation_key")
);
--> statement-breakpoint
CREATE TABLE "character_battle_stats" (
	"character_id" text PRIMARY KEY NOT NULL,
	"hp" integer NOT NULL,
	"attack" integer NOT NULL,
	"defense" integer NOT NULL,
	"action_speed" double precision NOT NULL,
	"range" integer NOT NULL,
	"skills" text DEFAULT '[]' NOT NULL,
	"attack_type" text DEFAULT 'melee' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_event_roles" (
	"character_id" text NOT NULL,
	"role" text NOT NULL,
	"action_id" text NOT NULL,
	CONSTRAINT "character_event_roles_character_id_role_pk" PRIMARY KEY("character_id","role")
);
--> statement-breakpoint
CREATE TABLE "character_spells" (
	"character_id" text NOT NULL,
	"spell_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "character_spells_character_id_spell_id_pk" PRIMARY KEY("character_id","spell_id")
);
--> statement-breakpoint
CREATE TABLE "damage_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "damage_config_id_check" CHECK ("damage_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "mock_battle_roster" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "roster_id_check" CHECK ("mock_battle_roster"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "spell_text_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "spell_text_config_id_check" CHECK ("spell_text_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "spells" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"animation_key" text,
	"type" text DEFAULT 'attack' NOT NULL,
	"power" double precision DEFAULT 1 NOT NULL,
	"cooldown" double precision DEFAULT 0 NOT NULL,
	"fps" double precision,
	"scale" double precision,
	"scale_x" double precision,
	"scale_y" double precision,
	"loop" integer,
	"duration" double precision,
	"offset_x" double precision,
	"offset_y" double precision,
	"rotation" double precision,
	"transition_in" text,
	"transition_out" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_campaigns_one_active" ON "campaigns" USING btree ("is_active") WHERE "campaigns"."is_active" = 1;