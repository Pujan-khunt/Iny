import { customType } from "drizzle-orm/pg-core";
import { index, integer, pgTable, primaryKey, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const messages = pgTable(
  "messages",
  {
    remoteJid: text("remote_jid").notNull(),
    messageId: text("message_id").notNull(),
    message: bytea("message").notNull(),
  },
  (table) => [primaryKey({ columns: [table.remoteJid, table.messageId] })],
);

export const allowedJids = pgTable("allowed_jids", {
  jid: text("jid").primaryKey(),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  sourcePath: text("source_path").notNull(),
  contentHash: text("content_hash").notNull().unique(),
  sourceType: text("source_type").notNull().default("document"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    sourceType: text("source_type").notNull().default("document"),
    pageStart: integer("page_start").notNull().default(1),
    pageEnd: integer("page_end").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chunks_document_id_idx").on(table.documentId),
    index("chunks_source_type_idx").on(table.sourceType),
    index("chunks_page_idx").on(table.pageStart, table.pageEnd),
    index("chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);