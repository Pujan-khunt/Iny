DROP INDEX "idx_allowed_users_lid";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_allowed_users_lid" ON "allowed_users" USING btree ("lid") WHERE "allowed_users"."lid" IS NOT NULL;