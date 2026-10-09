CREATE TYPE "public"."food_announcement_message_type" AS ENUM('image', 'document', 'text');--> statement-breakpoint
CREATE TYPE "public"."food_announcement_status" AS ENUM('pending', 'processed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."meal_change_type" AS ENUM('replacement', 'addition', 'cancellation');--> statement-breakpoint
CREATE TYPE "public"."meal_slot" AS ENUM('breakfast', 'lunch', 'dinner');--> statement-breakpoint
CREATE TYPE "public"."sender_address_type" AS ENUM('pn', 'lid');--> statement-breakpoint
CREATE TYPE "public"."vendor" AS ENUM('cheftalk_regular', 'cheftalk_jain', 'tcb');--> statement-breakpoint
CREATE TABLE "mess_meal_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_date" date NOT NULL,
	"meal_slot" "meal_slot" NOT NULL,
	"target_vendor" "vendor" NOT NULL,
	"change_type" "meal_change_type" NOT NULL,
	"affected_item" text NOT NULL,
	"original_item" text,
	"source_message_id" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_mess_meal_changes_replacement" CHECK ("mess_meal_changes"."change_type" != 'replacement' OR "mess_meal_changes"."original_item" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "mess_meal_location_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_date" date NOT NULL,
	"meal_slot" "meal_slot" DEFAULT 'lunch' NOT NULL,
	"hostel_batches" text[] NOT NULL,
	"college_batches" text[] NOT NULL,
	"source_message_id" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mess_meal_timing_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_date" date NOT NULL,
	"meal_slot" "meal_slot" NOT NULL,
	"target_vendor" "vendor",
	"extended_timings" text NOT NULL,
	"source_message_id" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mess_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_date" date NOT NULL,
	"meal_slot" "meal_slot" NOT NULL,
	"vendor" "vendor" NOT NULL,
	"items" text[] NOT NULL,
	"source_message_id" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_mess_meals_items_non_empty" CHECK (cardinality("mess_meals"."items") > 0)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_group_food_announcements_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"sender_address" text NOT NULL,
	"sender_address_type" "sender_address_type" NOT NULL,
	"message_type" "food_announcement_message_type" NOT NULL,
	"media_mime_type" text,
	"media_buffer" "bytea",
	"text_body" text,
	"status" "food_announcement_status" DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "chk_wa_food_media_or_text" CHECK ("whatsapp_group_food_announcements_messages"."media_buffer" IS NOT NULL OR "whatsapp_group_food_announcements_messages"."text_body" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "idx_mess_changes_date_slot" ON "mess_meal_changes" USING btree ("meal_date","meal_slot","target_vendor");--> statement-breakpoint
CREATE INDEX "idx_mess_changes_source_message_id" ON "mess_meal_changes" USING btree ("source_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mess_location_unique_slot" ON "mess_meal_location_details" USING btree ("meal_date","meal_slot");--> statement-breakpoint
CREATE INDEX "idx_mess_location_source_message_id" ON "mess_meal_location_details" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "idx_mess_timings_date_slot" ON "mess_meal_timing_extensions" USING btree ("meal_date","meal_slot");--> statement-breakpoint
CREATE INDEX "idx_mess_timings_source_message_id" ON "mess_meal_timing_extensions" USING btree ("source_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mess_meals_unique_slot" ON "mess_meals" USING btree ("meal_date","meal_slot","vendor");--> statement-breakpoint
CREATE INDEX "idx_mess_meals_source_message_id" ON "mess_meals" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "idx_wa_food_group_status_received" ON "whatsapp_group_food_announcements_messages" USING btree ("status","received_at" DESC NULLS LAST);