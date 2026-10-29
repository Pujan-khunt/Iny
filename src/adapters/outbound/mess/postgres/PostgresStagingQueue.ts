import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import {
	ListStagedMessagesOptions,
	NewStagedAnnouncementMessage,
	StagedAnnouncementMessage,
	StageMessageResult,
} from "../../../../core/ports/MessStagingRepositoryPort";
import { whatsappGroupFoodAnnouncementsMessages, type DbFoodAnnouncementStatus } from "./schema";

/**
 * Handles database operations for the food announcement staging queue.
 */
export class PostgresStagingQueue {
	constructor(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		private readonly db: PgDatabase<any, any, any>,
		private readonly logger: LoggerPort,
	) {}

	private buildDateConditions(dateStr: string): SQL[] {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
			throw new Error(`Invalid date format for filter: "${dateStr}". Expected ISO YYYY-MM-DD.`);
		}
		const startIst = new Date(`${dateStr}T00:00:00+05:30`);
		if (isNaN(startIst.getTime())) {
			throw new Error(`Invalid date value for filter: "${dateStr}". Expected valid calendar date.`);
		}
		const endIst = new Date(startIst.getTime() + 24 * 60 * 60 * 1000);
		return [
			gte(whatsappGroupFoodAnnouncementsMessages.receivedAt, startIst),
			lt(whatsappGroupFoodAnnouncementsMessages.receivedAt, endIst),
		];
	}

	private buildConditions(options?: ListStagedMessagesOptions): SQL[] {
		const conditions: SQL[] = [];
		if (options?.status) {
			conditions.push(
				eq(
					whatsappGroupFoodAnnouncementsMessages.status,
					options.status as DbFoodAnnouncementStatus,
				),
			);
		}
		if (options?.date) {
			conditions.push(...this.buildDateConditions(options.date));
		}
		return conditions;
	}

	/**
	 * Lists staged messages ordered by receivedAt DESC with optional status/date filters.
	 */
	async listStagedMessages(
		options?: ListStagedMessagesOptions,
	): Promise<StagedAnnouncementMessage[]> {
		this.logger.debug("Listing staged messages", { options });
		const conditions = this.buildConditions(options);
		let query = this.db.select().from(whatsappGroupFoodAnnouncementsMessages);
		if (conditions.length > 0) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			query = query.where(and(...conditions)) as any;
		}
		const limit = options?.limit ?? 10;
		const rows = await query
			.orderBy(desc(whatsappGroupFoodAnnouncementsMessages.receivedAt))
			.limit(limit);
		return rows as StagedAnnouncementMessage[];
	}

	/**
	 * Stages an inbound food announcement message into the staging table.
	 */
	async stageMessage(message: NewStagedAnnouncementMessage): Promise<StageMessageResult> {
		this.logger.debug("Staging inbound message", { id: message.id });
		const rows = await this.db
			.insert(whatsappGroupFoodAnnouncementsMessages)
			.values({
				id: message.id,
				senderAddress: message.senderAddress,
				senderAddressType: message.senderAddressType,
				messageType: message.messageType,
				mediaMimeType: message.mediaMimeType ?? null,
				mediaBuffer: (message.mediaBuffer as Buffer) ?? null,
				textBody: message.textBody ?? null,
				status: message.status ?? "pending",
				receivedAt: message.receivedAt ?? new Date(),
				processedAt: null,
			})
			.onConflictDoNothing()
			.returning({ id: whatsappGroupFoodAnnouncementsMessages.id });

		return rows.length > 0 ? "staged" : "already_staged";
	}

	/**
	 * Retrieves a staged message by its unique message ID.
	 */
	async getMessageById(id: string): Promise<StagedAnnouncementMessage | null> {
		this.logger.debug("Fetching staged message by id", { id });
		const rows = (await this.db
			.select()
			.from(whatsappGroupFoodAnnouncementsMessages)
			.where(eq(whatsappGroupFoodAnnouncementsMessages.id, id))
			.limit(1)) as StagedAnnouncementMessage[];
		return rows[0] ?? null;
	}

	/**
	 * Marks a staged message as 'ignored'.
	 */
	async markIgnored(id: string): Promise<void> {
		this.logger.info("Marking staged message as ignored", { id });
		await this.db
			.update(whatsappGroupFoodAnnouncementsMessages)
			.set({ status: "ignored" })
			.where(eq(whatsappGroupFoodAnnouncementsMessages.id, id));
	}
}
