import { describe, it, expect, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
	messMeals,
	messMealLocationDetails,
	messMealTimingExtensions,
	messMealChanges,
	whatsappGroupFoodAnnouncementsMessages,
	mealSlotEnum,
	vendorEnum,
	mealChangeTypeEnum,
	foodAnnouncementStatusEnum,
	foodAnnouncementMessageTypeEnum,
	senderAddressTypeEnum,
} from "../../../../../src/adapters/outbound/mess/postgres/schema";
import { parseConfig } from "../../../../../src/config";

describe("Mess Schema & Config", () => {
	describe("Basic Definitions and Auditability", () => {
		it("defines all 5 tables with expected columns and sourceMessageId", () => {
			expect(messMeals).toBeDefined();
			expect(messMealLocationDetails).toBeDefined();
			expect(messMealTimingExtensions).toBeDefined();
			expect(messMealChanges).toBeDefined();
			expect(whatsappGroupFoodAnnouncementsMessages).toBeDefined();

			expect(messMeals.sourceMessageId).toBeDefined();
			expect(messMealLocationDetails.sourceMessageId).toBeDefined();
			expect(messMealTimingExtensions.sourceMessageId).toBeDefined();
			expect(messMealChanges.sourceMessageId).toBeDefined();
		});

		it("defines native PostgreSQL enums with expected enum values", () => {
			expect(mealSlotEnum.enumValues).toEqual(["breakfast", "lunch", "dinner"]);
			expect(vendorEnum.enumValues).toEqual(["cheftalk_regular", "cheftalk_jain", "tcb"]);
			expect(mealChangeTypeEnum.enumValues).toEqual(["replacement", "addition", "cancellation"]);
			expect(foodAnnouncementStatusEnum.enumValues).toEqual(["pending", "processed", "ignored"]);
			expect(foodAnnouncementMessageTypeEnum.enumValues).toEqual(["image", "document", "text"]);
			expect(senderAddressTypeEnum.enumValues).toEqual(["pn", "lid"]);
		});

		it("rejects invalid FOOD_ANNOUNCEMENTS_GROUP_JID format in config", () => {
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			expect(() =>
				parseConfig({
					DEEPSEEK_API_KEY: "test-key",
					BOT_PHONE_NUMBER: "15551234567",
					DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/iny",
					FOOD_ANNOUNCEMENTS_GROUP_JID: "invalid_jid@s.whatsapp.net",
				}),
			).toThrow();
			errorSpy.mockRestore();
		});
	});

	describe("mess_meals Table Schema", () => {
		it("should define table name and expected column attributes with date and enums", () => {
			const config = getTableConfig(messMeals);
			expect(config.name).toBe("mess_meals");

			const columns = getTableColumns(messMeals);
			expect(columns.id).toBeDefined();
			expect(columns.mealDate).toBeDefined();
			expect(columns.mealSlot).toBeDefined();
			expect(columns.vendor).toBeDefined();
			expect(columns.items).toBeDefined();
			expect(columns.sourceMessageId).toBeDefined();
			expect(columns.ingestedAt).toBeDefined();

			expect(columns.id.primary).toBe(true);
			expect(columns.mealDate.notNull).toBe(true);
			expect(columns.mealDate.getSQLType()).toBe("date");
			expect(columns.mealSlot.notNull).toBe(true);
			expect(columns.mealSlot.columnType).toBe("PgEnumColumn");
			expect(columns.vendor.notNull).toBe(true);
			expect(columns.vendor.columnType).toBe("PgEnumColumn");
			expect(columns.items.notNull).toBe(true);
			expect(columns.sourceMessageId.notNull).toBe(false);
			expect(columns.ingestedAt.notNull).toBe(true);

			const checkNames = config.checks.map((chk) => chk.name);
			expect(checkNames).toContain("chk_mess_meals_items_non_empty");
		});

		it("should define unique slot index and sourceMessageId index", () => {
			const config = getTableConfig(messMeals);
			const indexNames = config.indexes.map((idx) => idx.config.name);
			expect(indexNames).toContain("idx_mess_meals_unique_slot");
			expect(indexNames).toContain("idx_mess_meals_source_message_id");

			const uniqueSlotIdx = config.indexes.find(
				(idx) => idx.config.name === "idx_mess_meals_unique_slot",
			);
			expect(uniqueSlotIdx?.config.unique).toBe(true);

			const sourceMsgIdx = config.indexes.find(
				(idx) => idx.config.name === "idx_mess_meals_source_message_id",
			);
			expect(sourceMsgIdx?.config.unique).toBe(false);
		});
	});

	describe("mess_meal_location_details Table Schema", () => {
		it("should define table name and expected column attributes with date and enums", () => {
			const config = getTableConfig(messMealLocationDetails);
			expect(config.name).toBe("mess_meal_location_details");

			const columns = getTableColumns(messMealLocationDetails);
			expect(columns.id).toBeDefined();
			expect(columns.mealDate).toBeDefined();
			expect(columns.mealSlot).toBeDefined();
			expect(columns.hostelBatches).toBeDefined();
			expect(columns.collegeBatches).toBeDefined();
			expect(columns.sourceMessageId).toBeDefined();
			expect(columns.ingestedAt).toBeDefined();

			expect(columns.id.primary).toBe(true);
			expect(columns.mealDate.notNull).toBe(true);
			expect(columns.mealDate.getSQLType()).toBe("date");
			expect(columns.mealSlot.notNull).toBe(true);
			expect(columns.mealSlot.columnType).toBe("PgEnumColumn");
			expect(columns.mealSlot.default).toBe("lunch");
			expect(columns.hostelBatches.notNull).toBe(true);
			expect(columns.collegeBatches.notNull).toBe(true);
			expect(columns.sourceMessageId.notNull).toBe(false);
			expect(columns.ingestedAt.notNull).toBe(true);
		});

		it("should define unique slot index and sourceMessageId index", () => {
			const config = getTableConfig(messMealLocationDetails);
			const indexNames = config.indexes.map((idx) => idx.config.name);
			expect(indexNames).toContain("idx_mess_location_unique_slot");
			expect(indexNames).toContain("idx_mess_location_source_message_id");

			const uniqueSlotIdx = config.indexes.find(
				(idx) => idx.config.name === "idx_mess_location_unique_slot",
			);
			expect(uniqueSlotIdx?.config.unique).toBe(true);
		});
	});

	describe("mess_meal_timing_extensions Table Schema", () => {
		it("should define table name and expected column attributes with date and enums", () => {
			const config = getTableConfig(messMealTimingExtensions);
			expect(config.name).toBe("mess_meal_timing_extensions");

			const columns = getTableColumns(messMealTimingExtensions);
			expect(columns.id).toBeDefined();
			expect(columns.mealDate).toBeDefined();
			expect(columns.mealSlot).toBeDefined();
			expect(columns.targetVendor).toBeDefined();
			expect(columns.extendedTimings).toBeDefined();
			expect(columns.sourceMessageId).toBeDefined();
			expect(columns.ingestedAt).toBeDefined();

			expect(columns.id.primary).toBe(true);
			expect(columns.mealDate.notNull).toBe(true);
			expect(columns.mealDate.getSQLType()).toBe("date");
			expect(columns.mealSlot.notNull).toBe(true);
			expect(columns.mealSlot.columnType).toBe("PgEnumColumn");
			expect(columns.targetVendor.notNull).toBe(false);
			expect(columns.targetVendor.columnType).toBe("PgEnumColumn");
			expect(columns.extendedTimings.notNull).toBe(true);
			expect(columns.sourceMessageId.notNull).toBe(false);
			expect(columns.ingestedAt.notNull).toBe(true);
		});

		it("should define date/slot index and sourceMessageId index", () => {
			const config = getTableConfig(messMealTimingExtensions);
			const indexNames = config.indexes.map((idx) => idx.config.name);
			expect(indexNames).toContain("idx_mess_timings_date_slot");
			expect(indexNames).toContain("idx_mess_timings_source_message_id");
		});
	});

	describe("mess_meal_changes Table Schema", () => {
		it("should define table name and expected column attributes with date, enums, and check constraints", () => {
			const config = getTableConfig(messMealChanges);
			expect(config.name).toBe("mess_meal_changes");

			const columns = getTableColumns(messMealChanges);
			expect(columns.id).toBeDefined();
			expect(columns.mealDate).toBeDefined();
			expect(columns.mealSlot).toBeDefined();
			expect(columns.targetVendor).toBeDefined();
			expect(columns.changeType).toBeDefined();
			expect(columns.affectedItem).toBeDefined();
			expect(columns.originalItem).toBeDefined();
			expect(columns.sourceMessageId).toBeDefined();
			expect(columns.ingestedAt).toBeDefined();

			expect(columns.id.primary).toBe(true);
			expect(columns.mealDate.notNull).toBe(true);
			expect(columns.mealDate.getSQLType()).toBe("date");
			expect(columns.mealSlot.notNull).toBe(true);
			expect(columns.mealSlot.columnType).toBe("PgEnumColumn");
			expect(columns.targetVendor.notNull).toBe(true);
			expect(columns.targetVendor.columnType).toBe("PgEnumColumn");
			expect(columns.changeType.notNull).toBe(true);
			expect(columns.changeType.columnType).toBe("PgEnumColumn");
			expect(columns.affectedItem.notNull).toBe(true);
			expect(columns.originalItem.notNull).toBe(false);
			expect(columns.sourceMessageId.notNull).toBe(false);
			expect(columns.ingestedAt.notNull).toBe(true);

			const checkNames = config.checks.map((chk) => chk.name);
			expect(checkNames).toContain("chk_mess_meal_changes_replacement");
		});

		it("should define date/slot index and sourceMessageId index", () => {
			const config = getTableConfig(messMealChanges);
			const indexNames = config.indexes.map((idx) => idx.config.name);
			expect(indexNames).toContain("idx_mess_changes_date_slot");
			expect(indexNames).toContain("idx_mess_changes_source_message_id");
		});
	});

	describe("whatsapp_group_food_announcements_messages Table Schema", () => {
		it("should define table name and expected column attributes including bytea media_buffer and enums", () => {
			const config = getTableConfig(whatsappGroupFoodAnnouncementsMessages);
			expect(config.name).toBe("whatsapp_group_food_announcements_messages");

			const columns = getTableColumns(whatsappGroupFoodAnnouncementsMessages);
			expect(columns.id).toBeDefined();
			expect(columns.senderAddress).toBeDefined();
			expect(columns.senderAddressType).toBeDefined();
			expect(columns.messageType).toBeDefined();
			expect(columns.mediaMimeType).toBeDefined();
			expect(columns.mediaBuffer).toBeDefined();
			expect(columns.textBody).toBeDefined();
			expect(columns.status).toBeDefined();
			expect(columns.receivedAt).toBeDefined();
			expect(columns.processedAt).toBeDefined();

			expect(columns.id.primary).toBe(true);
			expect(columns.senderAddress.notNull).toBe(true);
			expect(columns.senderAddressType.notNull).toBe(true);
			expect(columns.senderAddressType.columnType).toBe("PgEnumColumn");
			expect(columns.messageType.notNull).toBe(true);
			expect(columns.messageType.columnType).toBe("PgEnumColumn");
			expect(columns.mediaMimeType.notNull).toBe(false);
			expect(columns.mediaBuffer.notNull).toBe(false);
			expect(columns.mediaBuffer.dataType).toBe("custom");
			expect(columns.mediaBuffer.getSQLType()).toBe("bytea");
			expect(columns.textBody.notNull).toBe(false);
			expect(columns.status.notNull).toBe(true);
			expect(columns.status.columnType).toBe("PgEnumColumn");
			expect(columns.status.default).toBe("pending");
			expect(columns.receivedAt.notNull).toBe(true);
			expect(columns.processedAt.notNull).toBe(false);

			const checkNames = config.checks.map((chk) => chk.name);
			expect(checkNames).toContain("chk_wa_food_media_or_text");
		});

		it("should define status and receivedAt index", () => {
			const config = getTableConfig(whatsappGroupFoodAnnouncementsMessages);
			const indexNames = config.indexes.map((idx) => idx.config.name);
			expect(indexNames).toContain("idx_wa_food_group_status_received");
		});
	});
});
