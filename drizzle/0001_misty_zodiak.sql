CREATE TABLE "user_characters" (
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"exp" integer DEFAULT 0 NOT NULL,
	"hp" integer NOT NULL,
	"attack" integer NOT NULL,
	"defense" integer NOT NULL,
	"action_speed" double precision NOT NULL,
	"range" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_characters_user_id_character_id_pk" PRIMARY KEY("user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" text PRIMARY KEY NOT NULL,
	"total_wins" integer DEFAULT 0 NOT NULL,
	"total_losses" integer DEFAULT 0 NOT NULL,
	"total_exp" integer DEFAULT 0 NOT NULL,
	"total_kills" integer DEFAULT 0 NOT NULL
);
