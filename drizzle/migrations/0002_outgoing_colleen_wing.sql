CREATE TABLE "allowed_users" (
	"phone_number" text PRIMARY KEY NOT NULL,
	"jid" text NOT NULL,
	"lid" text,
	"name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_allowed_users_phone_digits" CHECK ("allowed_users"."phone_number" ~ '^[0-9]+$'),
	CONSTRAINT "chk_allowed_users_role" CHECK ("allowed_users"."role" IN ('admin', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_allowed_users_jid" ON "allowed_users" USING btree ("jid");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_allowed_users_lid" ON "allowed_users" USING btree ("lid");--> statement-breakpoint
CREATE INDEX "idx_allowed_users_is_active" ON "allowed_users" USING btree ("is_active");