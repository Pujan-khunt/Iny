import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { FoodAnnouncementSource } from "../../../../core/entities/FoodAnnouncement";
import {
	foodAnnouncementIngestions,
	foodIngestionSettings,
	whatsappGroupFoodAnnouncementsMessages,
} from "./schema";

/** Atomically captures raw food sources and admits only new live arrivals. */
export class PostgresFoodAdmission {
	/** @param db Existing database connection; all capture writes use one transaction. */
	constructor(private readonly db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>) {}

	/**
	 * Initializes a group's immutable activation boundary using database time.
	 * @param groupJid Official announcement group identifier.
	 * @returns Existing or newly inserted activation time; rejects on persistence failure.
	 */
	async initialize(groupJid: string): Promise<Date> {
		await this.db.insert(foodIngestionSettings).values({ groupJid }).onConflictDoNothing();
		const [settings] = await this.db
			.select({ activatedAt: foodIngestionSettings.activatedAt })
			.from(foodIngestionSettings)
			.where(eq(foodIngestionSettings.groupJid, groupJid));
		if (!settings) throw new Error("Food ingestion activation was not persisted");
		return settings.activatedAt;
	}

	/**
	 * Preserves staging and admission together, without enrolling existing staging IDs.
	 * @param source Original payload and transport metadata; invalid dates are ineligible.
	 * @returns Admission, ineligibility, or duplicate; raw persistence failures reject.
	 */
	async capture(source: FoodAnnouncementSource): Promise<"admitted" | "ineligible" | "duplicate"> {
		return this.db.transaction(async (tx) => {
			const rows = await tx
				.insert(whatsappGroupFoodAnnouncementsMessages)
				.values(this.stagingValues(source))
				.onConflictDoNothing()
				.returning({ id: whatsappGroupFoodAnnouncementsMessages.id });
			if (rows.length === 0) return "duplicate";
			const reason = await this.eligibilityReason(tx, source);
			const admitted = reason === "eligible";
			await tx.insert(foodAnnouncementIngestions).values({
				messageId: source.messageId,
				groupJid: source.groupJid,
				deliveryMode: source.deliveryMode,
				originalCreatedAt: this.validOriginalTime(source),
				capturedAt: source.capturedAt,
				eligibilityReason: reason,
				state: admitted ? "queued" : "ineligible",
				nextAttemptAt: admitted ? sql`now()` : null,
				decisionReason: admitted ? null : reason,
				completedAt: admitted ? null : sql`now()`,
			});
			return admitted ? "admitted" : "ineligible";
		});
	}

	private stagingValues(source: FoodAnnouncementSource) {
		return {
			id: source.messageId,
			senderAddress: source.senderAddress,
			senderAddressType: source.senderAddressType,
			messageType: source.messageType,
			mediaMimeType: source.mediaMimeType,
			mediaBuffer: source.mediaBytes === null ? null : Buffer.from(source.mediaBytes),
			textBody: source.textBody,
			receivedAt: this.validOriginalTime(source) ?? source.capturedAt,
		};
	}

	private validOriginalTime(source: FoodAnnouncementSource): Date | null {
		return source.originalCreatedAt && Number.isFinite(source.originalCreatedAt.getTime())
			? source.originalCreatedAt
			: null;
	}

	private async eligibilityReason(
		db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
		source: FoodAnnouncementSource,
	) {
		if (source.deliveryMode !== "notify") return "append_delivery";
		if (source.originalCreatedAt === null) return "missing_original_timestamp";
		const originalTime = this.validOriginalTime(source);
		if (!originalTime) return "invalid_original_timestamp";
		const [settings] = await db
			.select()
			.from(foodIngestionSettings)
			.where(eq(foodIngestionSettings.groupJid, source.groupJid));
		if (!settings) return "group_not_initialized";
		return originalTime >= settings.activatedAt ? "eligible" : "before_activation";
	}
}
