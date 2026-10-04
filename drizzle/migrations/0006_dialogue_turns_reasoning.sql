ALTER TABLE "dialogue_turns" ADD COLUMN "reasoning" text[] DEFAULT '{}'::text[] NOT NULL;
