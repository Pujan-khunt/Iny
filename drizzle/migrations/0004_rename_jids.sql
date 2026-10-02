ALTER TABLE "allowed_users" RENAME COLUMN "jid" TO "pn_jid";--> statement-breakpoint
ALTER TABLE "allowed_users" RENAME COLUMN "lid" TO "lid_jid";--> statement-breakpoint
ALTER INDEX "idx_allowed_users_jid" RENAME TO "idx_allowed_users_pn_jid";--> statement-breakpoint
ALTER INDEX "idx_allowed_users_lid" RENAME TO "idx_allowed_users_lid_jid";
