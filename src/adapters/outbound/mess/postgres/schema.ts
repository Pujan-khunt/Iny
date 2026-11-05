import {
	pgEnum,
	pgTable,
	date,
	text,
	timestamp,
	uuid,
	index,
	uniqueIndex,
	customType,
	check,
	integer,
	jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { MealSlot, Vendor, MealChangeType } from "../../../../core/entities/MessMeal";

// Native PostgreSQL Enums
export const mealSlotEnum = pgEnum("meal_slot", ["breakfast", "lunch", "dinner"]);
export const vendorEnum = pgEnum("vendor", ["cheftalk_regular", "cheftalk_jain", "tcb"]);
export const mealChangeTypeEnum = pgEnum("meal_change_type", [
	"replacement",
	"addition",
	"cancellation",
]);
export const foodAnnouncementStatusEnum = pgEnum("food_announcement_status", [
	"pending",
	"processed",
	"ignored",
]);
export const foodAnnouncementMessageTypeEnum = pgEnum("food_announcement_message_type", [
	"image",
	"document",
	"text",
]);
export const senderAddressTypeEnum = pgEnum("sender_address_type", ["pn", "lid"]);

export type DbMealSlot = (typeof mealSlotEnum.enumValues)[number];
export type DbVendor = (typeof vendorEnum.enumValues)[number];
export type DbMealChangeType = (typeof mealChangeTypeEnum.enumValues)[number];
export type DbFoodAnnouncementStatus = (typeof foodAnnouncementStatusEnum.enumValues)[number];
export type DbFoodAnnouncementMessageType =
	(typeof foodAnnouncementMessageTypeEnum.enumValues)[number];
export type DbSenderAddressType = (typeof senderAddressTypeEnum.enumValues)[number];

export const bytea = customType<{
	data: Buffer;
	driverData: Buffer;
	notNull: false;
	default: false;
}>({
	dataType() {
		return "bytea";
	},
});

export const messMeals = pgTable(
	"mess_meals",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		mealDate: date("meal_date", { mode: "string" }).notNull(),
		mealSlot: mealSlotEnum("meal_slot").notNull(),
		vendor: vendorEnum("vendor").notNull(),
		items: text("items").array().notNull(),
		sourceMessageId: text("source_message_id"),
		ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("idx_mess_meals_unique_slot").on(table.mealDate, table.mealSlot, table.vendor),
		index("idx_mess_meals_source_message_id").on(table.sourceMessageId),
		check("chk_mess_meals_items_non_empty", sql`cardinality(${table.items}) > 0`),
	],
);

export const messMealLocationDetails = pgTable(
	"mess_meal_location_details",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		mealDate: date("meal_date", { mode: "string" }).notNull(),
		mealSlot: mealSlotEnum("meal_slot").notNull().default("lunch"),
		hostelBatches: text("hostel_batches").array().notNull(),
		collegeBatches: text("college_batches").array().notNull(),
		sourceMessageId: text("source_message_id"),
		ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("idx_mess_location_unique_slot").on(table.mealDate, table.mealSlot),
		index("idx_mess_location_source_message_id").on(table.sourceMessageId),
	],
);

export const messMealTimingExtensions = pgTable(
	"mess_meal_timing_extensions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		mealDate: date("meal_date", { mode: "string" }).notNull(),
		mealSlot: mealSlotEnum("meal_slot").notNull(),
		targetVendor: vendorEnum("target_vendor"), // null = all vendors
		extendedTimings: text("extended_timings").notNull(),
		sourceMessageId: text("source_message_id"),
		ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_mess_timings_date_slot").on(table.mealDate, table.mealSlot),
		index("idx_mess_timings_source_message_id").on(table.sourceMessageId),
	],
);

export const messMealChanges = pgTable(
	"mess_meal_changes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		mealDate: date("meal_date", { mode: "string" }).notNull(),
		mealSlot: mealSlotEnum("meal_slot").notNull(),
		targetVendor: vendorEnum("target_vendor").notNull(),
		changeType: mealChangeTypeEnum("change_type").notNull(),
		affectedItem: text("affected_item").notNull(),
		originalItem: text("original_item"),
		sourceMessageId: text("source_message_id"),
		ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_mess_changes_date_slot").on(table.mealDate, table.mealSlot, table.targetVendor),
		index("idx_mess_changes_source_message_id").on(table.sourceMessageId),
		check(
			"chk_mess_meal_changes_replacement",
			sql`${table.changeType} != 'replacement' OR ${table.originalItem} IS NOT NULL`,
		),
	],
);

export const whatsappGroupFoodAnnouncementsMessages = pgTable(
	"whatsapp_group_food_announcements_messages",
	{
		id: text("id").primaryKey(),
		senderAddress: text("sender_address").notNull(),
		senderAddressType: senderAddressTypeEnum("sender_address_type").notNull(),
		messageType: foodAnnouncementMessageTypeEnum("message_type").notNull(),
		mediaMimeType: text("media_mime_type"),
		mediaBuffer: bytea("media_buffer"),
		textBody: text("text_body"),
		status: foodAnnouncementStatusEnum("status").notNull().default("pending"),
		receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_wa_food_group_status_received").on(table.status, table.receivedAt.desc()),
		check(
			"chk_wa_food_media_or_text",
			sql`${table.mediaBuffer} IS NOT NULL OR ${table.textBody} IS NOT NULL`,
		),
	],
);

export type MessMealRow = typeof messMeals.$inferSelect;
export type NewMessMealRow = typeof messMeals.$inferInsert;
export type MessMealLocationDetailRow = typeof messMealLocationDetails.$inferSelect;
export type NewMessMealLocationDetailRow = typeof messMealLocationDetails.$inferInsert;
export type MessMealTimingExtensionRow = typeof messMealTimingExtensions.$inferSelect;
export type NewMessMealTimingExtensionRow = typeof messMealTimingExtensions.$inferInsert;
export type MessMealChangeRow = typeof messMealChanges.$inferSelect;
export type NewMessMealChangeRow = typeof messMealChanges.$inferInsert;
export type WhatsappGroupFoodAnnouncementsMessageRow =
	typeof whatsappGroupFoodAnnouncementsMessages.$inferSelect;
export type NewWhatsappGroupFoodAnnouncementsMessageRow =
	typeof whatsappGroupFoodAnnouncementsMessages.$inferInsert;

// Compile-time static assertions ensuring Drizzle schemas match core domain entity types
export type _AssertMealSlot = MealSlot extends DbMealSlot ? true : never;
export type _AssertVendor = Vendor extends DbVendor ? true : never;
export type _AssertChangeType = MealChangeType extends DbMealChangeType ? true : never;

/** Persistent per-group activation boundary, created only by runtime initialization. */
export const foodIngestionSettings = pgTable(
	"food_ingestion_settings",
	{
		groupJid: text("group_jid").primaryKey(),
		activatedAt: timestamp("activated_at", { withTimezone: true, precision: 3 })
			.defaultNow()
			.notNull(),
		rulesVersion: text("rules_version").notNull().default("1"),
	},
	(table) => [check("chk_food_settings_identity", sql`length(${table.groupJid}) > 0`)],
);

/** Durable source provenance, work fencing, assessment evidence, and terminal decisions. */
export const foodAnnouncementIngestions = pgTable(
	"food_announcement_ingestions",
	{
		messageId: text("message_id")
			.primaryKey()
			.references(() => whatsappGroupFoodAnnouncementsMessages.id),
		groupJid: text("group_jid").notNull(),
		deliveryMode: text("delivery_mode", { enum: ["notify", "append"] }).notNull(),
		originalCreatedAt: timestamp("original_created_at", { withTimezone: true }),
		capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
		eligibilityReason: text("eligibility_reason").notNull(),
		state: text("state", {
			enum: ["queued", "processing", "accepted", "rejected", "failed", "ineligible"],
		}).notNull(),
		attemptCount: integer("attempt_count").notNull().default(0),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
		leaseToken: uuid("lease_token"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		decisionReason: text("decision_reason"),
		decisionDetail: text("decision_detail"),
		candidate: jsonb("candidate"),
		evidence: jsonb("evidence"),
		verification: jsonb("verification"),
		corrections: jsonb("corrections"),
		model: text("model"),
		promptVersion: text("prompt_version"),
		recognizedType: text("recognized_type"),
		rawExtraction: text("raw_extraction"),
		rawVerification: text("raw_verification"),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		check(
			"chk_food_ingestion_identity",
			sql`length(${table.messageId}) > 0 AND length(${table.groupJid}) > 0`,
		),
		check("chk_food_ingestion_delivery", sql`${table.deliveryMode} IN ('notify', 'append')`),
		check(
			"chk_food_ingestion_state",
			sql`${table.state} IN ('queued', 'processing', 'accepted', 'rejected', 'failed', 'ineligible')`,
		),
		check("chk_food_ingestion_attempts", sql`${table.attemptCount} >= 0`),
		check(
			"chk_food_ingestion_lease",
			sql`(${table.state} = 'processing' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.state} != 'processing' AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
		),
		check(
			"chk_food_ingestion_completion",
			sql`(${table.state} IN ('accepted', 'rejected', 'failed', 'ineligible')) = (${table.completedAt} IS NOT NULL)`,
		),
		index("idx_food_ingestion_runnable")
			.on(table.state, table.nextAttemptAt)
			.where(sql`${table.state} IN ('queued', 'processing')`),
	],
);

/** Immutable write evidence and snapshots; explicit reversal metadata never enrolls work. */
export const messIngestionOperationAudits = pgTable(
	"mess_ingestion_operation_audits",
	{
		operationId: uuid("operation_id").primaryKey().defaultRandom(),
		sourceMessageId: text("source_message_id").notNull(),
		originalCreatedAt: timestamp("original_created_at", { withTimezone: true }),
		mode: text("mode", { enum: ["manual", "automatic"] }).notNull(),
		affectedFactKeys: text("affected_fact_keys").array().notNull(),
		extractionEvidence: jsonb("extraction_evidence"),
		reviewEvidence: jsonb("review_evidence"),
		corrections: jsonb("corrections"),
		beforeImages: jsonb("before_images").notNull(),
		afterImages: jsonb("after_images").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		reversedAt: timestamp("reversed_at", { withTimezone: true }),
		reversalReason: text("reversal_reason"),
	},
	(table) => [
		check("chk_mess_audit_mode", sql`${table.mode} IN ('manual', 'automatic')`),
		index("idx_mess_audit_source").on(table.sourceMessageId),
		index("idx_mess_audit_fact_keys").using("gin", table.affectedFactKeys),
	],
);
