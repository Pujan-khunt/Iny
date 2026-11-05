CREATE TABLE "food_announcement_ingestions" (
	"message_id" text PRIMARY KEY NOT NULL,
	"group_jid" text NOT NULL,
	"delivery_mode" text NOT NULL,
	"original_created_at" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL,
	"eligibility_reason" text NOT NULL,
	"state" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"decision_reason" text,
	"decision_detail" text,
	"candidate" jsonb,
	"evidence" jsonb,
	"verification" jsonb,
	"corrections" jsonb,
	"model" text,
	"prompt_version" text,
	"recognized_type" text,
	"raw_extraction" text,
	"raw_verification" text,
	"completed_at" timestamp with time zone,
	CONSTRAINT "chk_food_ingestion_identity" CHECK (length("food_announcement_ingestions"."message_id") > 0 AND length("food_announcement_ingestions"."group_jid") > 0),
	CONSTRAINT "chk_food_ingestion_delivery" CHECK ("food_announcement_ingestions"."delivery_mode" IN ('notify', 'append')),
	CONSTRAINT "chk_food_ingestion_state" CHECK ("food_announcement_ingestions"."state" IN ('queued', 'processing', 'accepted', 'rejected', 'failed', 'ineligible')),
	CONSTRAINT "chk_food_ingestion_attempts" CHECK ("food_announcement_ingestions"."attempt_count" >= 0),
	CONSTRAINT "chk_food_ingestion_lease" CHECK (("food_announcement_ingestions"."state" = 'processing' AND "food_announcement_ingestions"."lease_token" IS NOT NULL AND "food_announcement_ingestions"."lease_expires_at" IS NOT NULL) OR ("food_announcement_ingestions"."state" != 'processing' AND "food_announcement_ingestions"."lease_token" IS NULL AND "food_announcement_ingestions"."lease_expires_at" IS NULL)),
	CONSTRAINT "chk_food_ingestion_completion" CHECK (("food_announcement_ingestions"."state" IN ('accepted', 'rejected', 'failed', 'ineligible')) = ("food_announcement_ingestions"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "food_ingestion_settings" (
	"group_jid" text PRIMARY KEY NOT NULL,
	"activated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"rules_version" text DEFAULT '1' NOT NULL,
	CONSTRAINT "chk_food_settings_identity" CHECK (length("food_ingestion_settings"."group_jid") > 0)
);
--> statement-breakpoint
CREATE TABLE "mess_ingestion_operation_audits" (
	"operation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_message_id" text NOT NULL,
	"original_created_at" timestamp with time zone,
	"mode" text NOT NULL,
	"affected_fact_keys" text[] NOT NULL,
	"extraction_evidence" jsonb,
	"review_evidence" jsonb,
	"corrections" jsonb,
	"before_images" jsonb NOT NULL,
	"after_images" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "chk_mess_audit_mode" CHECK ("mess_ingestion_operation_audits"."mode" IN ('manual', 'automatic'))
);
--> statement-breakpoint
ALTER TABLE "food_announcement_ingestions" ADD CONSTRAINT "food_announcement_ingestions_message_id_whatsapp_group_food_announcements_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."whatsapp_group_food_announcements_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_food_ingestion_runnable" ON "food_announcement_ingestions" USING btree ("state","next_attempt_at") WHERE "food_announcement_ingestions"."state" IN ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "idx_mess_audit_source" ON "mess_ingestion_operation_audits" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "idx_mess_audit_fact_keys" ON "mess_ingestion_operation_audits" USING gin ("affected_fact_keys");