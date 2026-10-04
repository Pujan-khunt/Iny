ALTER TABLE "allowed_users" RENAME TO "users";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "jid" TO "pn_jid";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "lid" TO "lid_jid";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "chk_allowed_users_phone_digits";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "chk_allowed_users_role";--> statement-breakpoint
DROP INDEX "idx_allowed_users_jid";--> statement-breakpoint
DROP INDEX "idx_allowed_users_lid";--> statement-breakpoint
DROP INDEX "idx_allowed_users_is_active";--> statement-breakpoint
ALTER TABLE "dialogue_turns" ADD COLUMN "reasoning" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "status" = CASE WHEN "is_active" = true THEN 'active' ELSE 'revoked' END;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_pn_jid" ON "users" USING btree ("pn_jid");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_lid_jid" ON "users" USING btree ("lid_jid") WHERE "users"."lid_jid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "chk_users_phone_digits" CHECK ("users"."phone_number" ~ '^[0-9]+$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "chk_users_role" CHECK ("users"."role" IN ('admin', 'user'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "chk_users_status" CHECK ("users"."status" IN ('active', 'pending', 'revoked', 'suspended'));