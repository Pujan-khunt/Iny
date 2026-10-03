ALTER TABLE "allowed_users" RENAME TO "users";--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "allowed_users_pkey" TO "users_pkey";--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "chk_allowed_users_phone_digits" TO "chk_users_phone_digits";--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "chk_allowed_users_role" TO "chk_users_role";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "status" = CASE WHEN "is_active" = true THEN 'active' ELSE 'revoked' END;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_allowed_users_is_active";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "chk_users_status" CHECK ("status" IN ('active', 'pending', 'revoked', 'suspended'));--> statement-breakpoint
ALTER INDEX "idx_allowed_users_pn_jid" RENAME TO "idx_users_pn_jid";--> statement-breakpoint
ALTER INDEX "idx_allowed_users_lid_jid" RENAME TO "idx_users_lid_jid";--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");
