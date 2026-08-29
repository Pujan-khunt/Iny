CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "allowed_jids" (
	"jid" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"content" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536),
	"source_type" text DEFAULT 'document' NOT NULL,
	"page_start" integer DEFAULT 1 NOT NULL,
	"page_end" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_type" text DEFAULT 'document' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"remote_jid" text NOT NULL,
	"message_id" text NOT NULL,
	"message" "bytea" NOT NULL,
	CONSTRAINT "messages_remote_jid_message_id_pk" PRIMARY KEY("remote_jid","message_id")
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_document_id_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunks_source_type_idx" ON "chunks" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "chunks_page_idx" ON "chunks" USING btree ("page_start","page_end");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_fts_idx" ON "chunks" USING gin (to_tsvector('english', "content"));
