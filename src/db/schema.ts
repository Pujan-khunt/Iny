import { customType } from "drizzle-orm/pg-core";
import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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