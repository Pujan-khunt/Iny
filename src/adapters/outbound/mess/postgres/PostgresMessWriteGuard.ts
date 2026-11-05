import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { FoodDecision } from "../../../../core/entities/FoodIngestion";
import type { StagedMealSwap } from "../../../../core/entities/MessAnnouncement";
import type { ResolvedMealSwapInput } from "../../../../core/entities/MessCommit";
import type { Vendor } from "../../../../core/entities/MessMeal";
import { PostgresMessOperationAudit } from "./PostgresMessOperationAudit";
import { whatsappGroupFoodAnnouncementsMessages as staging } from "./schema";
const vendors: readonly Vendor[] = ["cheftalk_regular", "cheftalk_jain", "tcb"];

/** Serializes mess mutations and preflights source order and complete swap prerequisites. */
export class PostgresMessWriteGuard {
	/** @param audit Transaction-scoped provenance and prerequisite reader. */
	constructor(private readonly audit: PostgresMessOperationAudit) {}

	/**
	 * Acquires the one shared lock before row fences and writes; releases at transaction end.
	 * @param tx Caller-owned transaction without external work; SQL failures reject.
	 */
	async lock(tx: PgDatabase<PgQueryResultHKT, Record<string, unknown>>): Promise<void> {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(730201, 1)`);
	}

	/** Locks staging and checks whether manual or automatic mutation is still permitted. */
	async permits(
		tx: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
		operation: { messageId: string; mode: "manual" | "automatic" },
	) {
		const [row] = await tx
			.select()
			.from(staging)
			.where(eq(staging.id, operation.messageId))
			.for("update");
		if (!row || row.status === "processed") return false;
		return operation.mode === "manual" || row.status === "pending";
	}

	/**
	 * @param tx Caller transaction already holding the shared lock; SQL failures reject.
	 * @param source Original identity/time, never a capture-time fallback.
	 * @param keys Complete affected keys; returns accepted preflight or semantic rejection.
	 */
	async checkOrder(
		tx: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
		source: { messageId: string; originalCreatedAt: Date | null },
		keys: readonly string[],
	): Promise<FoodDecision> {
		const owners = await this.audit.owners(tx, keys);
		if (owners.length === 0) return { outcome: "accepted" };
		const time = source.originalCreatedAt?.getTime();
		if (time === undefined || !Number.isFinite(time))
			return this.reject(
				"unknown_provenance",
				"Incoming source has no trustworthy original timestamp",
			);
		for (const owner of owners) {
			const conflict = this.ownerConflict(owner, time, source.messageId);
			if (conflict) return conflict;
		}
		return { outcome: "accepted" };
	}

	/**
	 * @param tx Caller transaction holding the shared lock; SQL failures reject.
	 * @param expected Original scopes, snapshots and mode; automatic null requires all vendors.
	 * @returns Accepted preflight or changed_prerequisite; performs no writes.
	 */
	async checkSwapSnapshots(
		tx: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
		expected: {
			swaps: readonly StagedMealSwap[];
			resolvedSwaps: readonly ResolvedMealSwapInput[];
			mode?: "manual" | "automatic";
		},
	): Promise<FoodDecision> {
		const covered = new Set<ResolvedMealSwapInput>();
		for (const swap of expected.swaps) {
			const source = await this.audit.meals(tx, swap.sourceMealDate, swap.sourceMealSlot);
			const target = await this.audit.meals(tx, swap.targetMealDate, swap.targetMealSlot);
			const scope = this.scope(swap, source, expected.mode);
			if (scope.length === 0) return this.changed();
			for (const vendor of scope) {
				const matches = expected.resolvedSwaps.filter((row) => this.matches(row, swap, vendor));
				const row = matches[0];
				if (matches.length !== 1 || !row || covered.has(row)) return this.changed();
				const before = source.filter((meal) => meal.vendor === vendor);
				const after = target.filter((meal) => meal.vendor === vendor);
				if (!this.sameItems(before, row.newItems) || !this.sameItems(after, row.previousItems))
					return this.changed();
				covered.add(row);
			}
		}
		return covered.size === expected.resolvedSwaps.length
			? { outcome: "accepted" }
			: this.changed();
	}
	private scope(
		swap: StagedMealSwap,
		source: readonly { vendor: Vendor }[],
		mode: "manual" | "automatic" = "automatic",
	): readonly Vendor[] {
		if (mode === "manual" && swap.targetVendor == null) return source.map((row) => row.vendor);
		if (swap.targetVendor === undefined) return [];
		return swap.targetVendor === null ? vendors : [swap.targetVendor];
	}
	private ownerConflict(
		owner: Awaited<ReturnType<PostgresMessOperationAudit["owners"]>>[number],
		time: number,
		messageId: string,
	): FoodDecision | null {
		const previous =
			owner.originalCreatedAt === null ? NaN : new Date(owner.originalCreatedAt).getTime();
		if (!owner.messageId || !Number.isFinite(previous))
			return this.reject("unknown_provenance", `Cannot establish provenance for ${owner.key}`);
		if (previous > time) return this.reject("stale_source", `Newer source owns ${owner.key}`);
		if (previous === time && owner.messageId !== messageId)
			return this.reject(
				"equal_timestamp_conflict",
				`Distinct equal-time source owns ${owner.key}`,
			);
		return null;
	}

	private matches(row: ResolvedMealSwapInput, swap: StagedMealSwap, vendor: Vendor) {
		return (
			row.vendor === vendor &&
			row.sourceMealDate === swap.sourceMealDate &&
			row.sourceMealSlot === swap.sourceMealSlot &&
			row.targetMealDate === swap.targetMealDate &&
			row.targetMealSlot === swap.targetMealSlot
		);
	}
	private sameItems(rows: { items: string[] }[], items: readonly string[]) {
		return (
			rows.length === 1 &&
			items.length > 0 &&
			JSON.stringify(rows[0].items) === JSON.stringify(items)
		);
	}
	private changed(): FoodDecision {
		return this.reject(
			"changed_prerequisite",
			"Swap prerequisite vendor coverage or items changed",
		);
	}
	private reject(reason: string, detail: string): FoodDecision {
		return { outcome: "rejected", reason, detail };
	}
}
