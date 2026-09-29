CREATE TABLE "dialogue_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"user_query" text NOT NULL,
	"assistant_response" text NOT NULL,
	"tool_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"duration_ms" integer GENERATED ALWAYS AS (ROUND(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::integer) STORED,
	"messages" jsonb NOT NULL,
	CONSTRAINT "chk_dialogue_turns_timing" CHECK ("dialogue_turns"."completed_at" >= "dialogue_turns"."started_at"),
	CONSTRAINT "chk_dialogue_turns_messages" CHECK (jsonb_array_length("dialogue_turns"."messages") >= 2 AND ("dialogue_turns"."messages"->0->>'role') = 'user' AND ("dialogue_turns"."messages"->-1->>'role') = 'assistant' AND ("dialogue_turns"."messages"->-1->'toolCalls') IS NULL)
);
--> statement-breakpoint
CREATE INDEX "idx_dialogue_turns_user_completed" ON "dialogue_turns" USING btree ("user_id","completed_at" DESC NULLS LAST);