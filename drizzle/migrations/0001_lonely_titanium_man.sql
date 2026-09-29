CREATE TABLE "whatsapp_auth" (
	"session_id" varchar(128) DEFAULT 'default' NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_auth_session_id_key_pk" PRIMARY KEY("session_id","key")
);
