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
