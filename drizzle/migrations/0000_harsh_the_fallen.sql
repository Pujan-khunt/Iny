CREATE TABLE "dialogue_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"user_query" text NOT NULL,
	"assistant_response" text NOT NULL,
	"tool_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"duration_ms" integer GENERATED ALWAYS AS (ROUND(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::integer) STORED,
	"messages" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_dialogue_turns_user_completed" ON "dialogue_turns" USING btree ("user_id","completed_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "dialogue_turns" ADD CONSTRAINT "chk_dialogue_turns_messages"
CHECK (
  jsonb_typeof("messages") = 'array'
  AND jsonb_array_length("messages") >= 2
  AND ("messages"->0->>'role') = 'user'
  AND ("messages"->-1->>'role') = 'assistant'
  AND ("messages"->-1->'toolCalls') IS NULL
);
--> statement-breakpoint
ALTER TABLE "dialogue_turns" ADD CONSTRAINT "chk_dialogue_turns_timing"
CHECK ("completed_at" >= "started_at");