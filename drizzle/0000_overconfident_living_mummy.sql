CREATE TABLE "allowed_jids" (
	"jid" text PRIMARY KEY NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"remote_jid" text NOT NULL,
	"message_id" text NOT NULL,
	"message" "bytea" NOT NULL,
	CONSTRAINT "messages_remote_jid_message_id_pk" PRIMARY KEY("remote_jid","message_id")
);
