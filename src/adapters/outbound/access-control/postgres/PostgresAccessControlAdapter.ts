import { eq, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { users } from "./schema";
import {
	AccessControlPort,
	AccessControlAdminPort,
	UserRecord,
	SeedUserEntry,
} from "../../../../core/ports/AccessControlPort";
import { Vendor } from "../../../../core/entities/MessMeal";
import { WhatsAppJid } from "../../../common/whatsapp/WhatsAppJid";
import { LoggerPort } from "../../../../core/ports/LoggerPort";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgDb = NodePgDatabase<any> | PostgresJsDatabase<any>;

export class PostgresAccessControlAdapter implements AccessControlPort, AccessControlAdminPort {
	constructor(
		private db: PgDb,
		private logger: LoggerPort,
	) {}

	async authenticate(address: string, companionLidJid?: string | null): Promise<UserRecord | null> {
		const user = await this.getUser(address);
		if (!user) return null;

		if (user.status !== "active") {
			this.logger.warn("Blocked interaction from inactive user", undefined, {
				phoneNumber: user.phoneNumber,
				status: user.status,
				address,
			});
			return null;
		}

		if (!user.lidJid && companionLidJid) {
			await this.tryCacheLid(user, companionLidJid);
		}

		return user;
	}

	async getUser(address: string): Promise<UserRecord | null> {
		const query = this.buildAddressQuery(address);
		if (!query) return null;

		const rows = await this.db.select().from(users).where(query).limit(1);
		return rows[0] ?? null;
	}

	async setDefaultVendor(address: string, vendor: Vendor): Promise<void> {
		const query = this.buildAddressQuery(address);
		if (!query) {
			throw new Error(`Invalid address for setDefaultVendor: ${address}`);
		}
		await this.db.update(users).set({ defaultVendor: vendor, updatedAt: new Date() }).where(query);
	}

	async seedUsers(entries: SeedUserEntry[]): Promise<void> {
		for (const entry of entries) {
			const pnJid = WhatsAppJid.normalize(entry.phoneNumber);
			const phoneNumber = WhatsAppJid.toPhoneNumber(entry.phoneNumber);

			if (!pnJid || !phoneNumber) {
				this.logger.warn("Skipping invalid access control entry during seeding", undefined, {
					entry,
				});
				continue;
			}

			await this.db
				.insert(users)
				.values({
					phoneNumber,
					pnJid,
					lidJid: null,
					name: entry.name || null,
					role: "admin",
					status: "active",
					defaultVendor: "cheftalk_regular",
				})
				.onConflictDoNothing({ target: users.phoneNumber });
		}
	}

	async countActiveUsers(): Promise<number> {
		const result = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(users)
			.where(eq(users.status, "active"));

		return result[0]?.count ?? 0;
	}

	private buildAddressQuery(address: string) {
		const normalized = WhatsAppJid.normalize(address);
		if (!normalized) return null;
		if (WhatsAppJid.isLidUser(normalized)) return eq(users.lidJid, normalized);
		if (WhatsAppJid.isPnUser(normalized)) return eq(users.pnJid, normalized);
		return null;
	}

	private async tryCacheLid(user: UserRecord, companionLidJid: string): Promise<void> {
		const normalizedLidJid = WhatsAppJid.normalize(companionLidJid);
		if (!normalizedLidJid || !WhatsAppJid.isLidUser(normalizedLidJid)) return;
		try {
			await this.cacheLidJid(user.phoneNumber, normalizedLidJid);
			this.logger.info("Cached linked identity (LID) for user", {
				phoneNumber: user.phoneNumber,
				lidJid: normalizedLidJid,
			});
			user.lidJid = normalizedLidJid;
		} catch (err) {
			this.logger.warn("Failed to cache user LID", err, {
				phoneNumber: user.phoneNumber,
				lidJid: normalizedLidJid,
			});
		}
	}

	private async cacheLidJid(phoneNumber: string, lidJid: string): Promise<void> {
		await this.db
			.update(users)
			.set({ lidJid, updatedAt: new Date() })
			.where(eq(users.phoneNumber, phoneNumber));
	}
}
