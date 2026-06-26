CREATE TABLE "user_character_spells" (
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"spell_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_character_spells_user_id_character_id_spell_id_pk" PRIMARY KEY("user_id","character_id","spell_id")
);
--> statement-breakpoint
ALTER TABLE "spells" ADD COLUMN "price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spells" ADD COLUMN "mana_cost" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_characters" ADD COLUMN "is_dead" integer DEFAULT 0 NOT NULL;