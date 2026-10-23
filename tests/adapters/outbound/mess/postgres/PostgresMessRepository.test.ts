import { describe, it, expect, beforeEach, vi } from "vitest";
import { newDb } from "pg-mem";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresMessRepository } from "../../../../../src/adapters/outbound/mess/postgres/PostgresMessRepository.js";
import { LoggerPort } from "../../../../../src/core/ports/LoggerPort.js";

describe("PostgresMessRepository", () => {
	let db: NodePgDatabase;
	let repository: PostgresMessRepository;
	const mockLogger: LoggerPort = {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	} as unknown as LoggerPort;

	beforeEach(() => {
		vi.clearAllMocks();

		const memDb = newDb();
		memDb.public.none(`
      CREATE TYPE meal_slot AS ENUM ('breakfast', 'lunch', 'dinner');
      CREATE TYPE vendor AS ENUM ('cheftalk_regular', 'cheftalk_jain', 'tcb');
      CREATE TYPE meal_change_type AS ENUM ('replacement', 'addition', 'cancellation');

      CREATE TABLE mess_meals (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL,
        vendor vendor NOT NULL,
        items TEXT[] NOT NULL,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE mess_meal_location_details (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL,
        hostel_batches TEXT[] NOT NULL,
        college_batches TEXT[] NOT NULL,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE mess_meal_timing_extensions (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL,
        target_vendor vendor,
        extended_timings TEXT NOT NULL,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE mess_meal_changes (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL,
        target_vendor vendor NOT NULL,
        change_type meal_change_type NOT NULL,
        affected_item TEXT NOT NULL,
        original_item TEXT,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

		const { Pool } = memDb.adapters.createPg();
		const pool = new Pool();
		const origQuery = pool.query.bind(pool);
		pool.query = async function (queryTextOrConfig: any, values: any, callback: any) {
			let isRowModeArray = false;
			if (typeof queryTextOrConfig === "object" && queryTextOrConfig !== null) {
				if (queryTextOrConfig.rowMode === "array") {
					isRowModeArray = true;
					delete queryTextOrConfig.rowMode;
				}
				delete queryTextOrConfig.types;
			}
			const result = await origQuery(queryTextOrConfig, values, callback);
			if (isRowModeArray && result && Array.isArray(result.rows)) {
				result.rows = result.rows.map((row: any) => Object.values(row));
			}
			return result;
		};

		db = drizzle(pool);
		repository = new PostgresMessRepository(db as any, mockLogger);
	});

	it("retrieves resolved meal for a specific slot and vendor (Quadrant 2)", async () => {
		// Seed test data
		await db.execute(`
      INSERT INTO mess_meals (id, meal_date, meal_slot, vendor, items)
      VALUES
        ('a0000000-0000-0000-0000-000000000001', '2026-10-08', 'lunch', 'cheftalk_regular', ARRAY['Rajma', 'Rice', 'Roti']),
        ('a0000000-0000-0000-0000-000000000002', '2026-10-08', 'lunch', 'cheftalk_jain', ARRAY['Yellow Dal', 'Rice']),
        ('a0000000-0000-0000-0000-000000000003', '2026-10-08', 'dinner', 'cheftalk_regular', ARRAY['Paneer', 'Roti']);

      INSERT INTO mess_meal_location_details (id, meal_date, meal_slot, hostel_batches, college_batches)
      VALUES
        ('b0000000-0000-0000-0000-000000000001', '2026-10-08', 'lunch', ARRAY['2027', '2028'], ARRAY['ALL_OTHER']);

      INSERT INTO mess_meal_timing_extensions (id, meal_date, meal_slot, target_vendor, extended_timings)
      VALUES
        ('c0000000-0000-0000-0000-000000000001', '2026-10-08', 'lunch', 'cheftalk_regular', 'Extended till 3:00 PM');

      INSERT INTO mess_meal_changes (id, meal_date, meal_slot, target_vendor, change_type, affected_item, original_item)
      VALUES
        ('d0000000-0000-0000-0000-000000000001', '2026-10-08', 'lunch', 'cheftalk_regular', 'replacement', 'Kadai Paneer', 'Paneer Butter Masala');
    `);

		const resolved = await repository.getResolvedMeal({
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			vendor: "cheftalk_regular",
		});

		expect(resolved.mealDate).toBe("2026-10-08");
		expect(resolved.mealSlot).toBe("lunch");
		expect(resolved.meals).toHaveLength(1);
		expect(resolved.meals[0].vendor).toBe("cheftalk_regular");
		expect(resolved.meals[0].items).toEqual(["Rajma", "Rice", "Roti"]);

		expect(resolved.locationDetail).not.toBeNull();
		expect(resolved.locationDetail?.hostelBatches).toEqual(["2027", "2028"]);
		expect(resolved.locationDetail?.collegeBatches).toEqual(["ALL_OTHER"]);

		expect(resolved.timingExtensions).toHaveLength(1);
		expect(resolved.timingExtensions[0].extendedTimings).toBe("Extended till 3:00 PM");

		expect(resolved.mealChanges).toHaveLength(1);
		expect(resolved.mealChanges[0].affectedItem).toBe("Kadai Paneer");
		expect(resolved.mealChanges[0].originalItem).toBe("Paneer Butter Masala");
	});

	it("retrieves multi-vendor resolved meals for a specific slot without vendor (Quadrant 1)", async () => {
		await db.execute(`
      INSERT INTO mess_meals (id, meal_date, meal_slot, vendor, items)
      VALUES
        ('a0000000-0000-0000-0000-000000000001', '2026-10-08', 'lunch', 'cheftalk_regular', ARRAY['Rajma', 'Rice']),
        ('a0000000-0000-0000-0000-000000000002', '2026-10-08', 'lunch', 'cheftalk_jain', ARRAY['Yellow Dal', 'Rice']),
        ('a0000000-0000-0000-0000-000000000003', '2026-10-08', 'lunch', 'tcb', ARRAY['Chole', 'Bhature']);
    `);

		const resolved = await repository.getResolvedMeal({
			mealDate: "2026-10-08",
			mealSlot: "lunch",
		});

		expect(resolved.mealDate).toBe("2026-10-08");
		expect(resolved.mealSlot).toBe("lunch");
		expect(resolved.meals).toHaveLength(3);
		const vendors = resolved.meals.map((m) => m.vendor);
		expect(vendors).toContain("cheftalk_regular");
		expect(vendors).toContain("cheftalk_jain");
		expect(vendors).toContain("tcb");
		expect(resolved.locationDetail).toBeNull();
		expect(resolved.timingExtensions).toEqual([]);
		expect(resolved.mealChanges).toEqual([]);
	});

	it("retrieves full-day meals when mealSlot is omitted (Quadrant 4 & Full-Day)", async () => {
		await db.execute(`
      INSERT INTO mess_meals (id, meal_date, meal_slot, vendor, items)
      VALUES
        ('a0000000-0000-0000-0000-000000000001', '2026-10-08', 'breakfast', 'tcb', ARRAY['Poha', 'Jalebi']),
        ('a0000000-0000-0000-0000-000000000002', '2026-10-08', 'lunch', 'tcb', ARRAY['Chole Bhature']),
        ('a0000000-0000-0000-0000-000000000003', '2026-10-08', 'dinner', 'tcb', ARRAY['Biryani']);

      INSERT INTO mess_meal_location_details (id, meal_date, meal_slot, hostel_batches, college_batches)
      VALUES
        ('b0000000-0000-0000-0000-000000000001', '2026-10-08', 'lunch', ARRAY['ALL_BATCHES'], ARRAY[]::TEXT[]);
    `);

		const resolved = await repository.getResolvedMeal({
			mealDate: "2026-10-08",
			vendor: "tcb",
		});

		expect(resolved.mealDate).toBe("2026-10-08");
		expect(resolved.mealSlot).toBeNull();
		expect(resolved.meals).toHaveLength(3);
		const slots = resolved.meals.map((m) => m.mealSlot);
		expect(slots).toEqual(["breakfast", "lunch", "dinner"]);
		expect(resolved.locationDetail).not.toBeNull();
		expect(resolved.locationDetail?.hostelBatches).toEqual(["ALL_BATCHES"]);
	});

	it("returns empty collections when no records match query", async () => {
		const resolved = await repository.getResolvedMeal({
			mealDate: "2026-10-08",
			mealSlot: "breakfast",
		});

		expect(resolved.mealDate).toBe("2026-10-08");
		expect(resolved.mealSlot).toBe("breakfast");
		expect(resolved.meals).toEqual([]);
		expect(resolved.locationDetail).toBeNull();
		expect(resolved.timingExtensions).toEqual([]);
		expect(resolved.mealChanges).toEqual([]);
	});

	it("isolates data strictly by mealDate", async () => {
		await db.execute(`
      INSERT INTO mess_meals (id, meal_date, meal_slot, vendor, items)
      VALUES
        ('a0000000-0000-0000-0000-000000000001', '2026-10-07', 'lunch', 'tcb', ARRAY['Old Food']),
        ('a0000000-0000-0000-0000-000000000002', '2026-10-08', 'lunch', 'tcb', ARRAY['New Food']);

      INSERT INTO mess_meal_timing_extensions (id, meal_date, meal_slot, extended_timings)
      VALUES
        ('c0000000-0000-0000-0000-000000000001', '2026-10-07', 'lunch', 'Old Timing');

      INSERT INTO mess_meal_changes (id, meal_date, meal_slot, target_vendor, change_type, affected_item)
      VALUES
        ('d0000000-0000-0000-0000-000000000001', '2026-10-07', 'lunch', 'tcb', 'addition', 'Old Extra Item');
    `);

		const resolved = await repository.getResolvedMeal({
			mealDate: "2026-10-08",
			mealSlot: "lunch",
		});

		expect(resolved.meals).toHaveLength(1);
		expect(resolved.meals[0].items).toEqual(["New Food"]);
		expect(resolved.timingExtensions).toEqual([]);
		expect(resolved.mealChanges).toEqual([]);
	});

	it("executes queries concurrently using Promise.all", async () => {
		let activeQueries = 0;
		let maxConcurrentQueries = 0;

		const originalSelect = (db as any).select.bind(db);
		const selectSpy = vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
			const originalBuilder = originalSelect(...(args as [any?]));
			return {
				from: (...fromArgs: unknown[]) => {
					const fromResult = originalBuilder.from(...(fromArgs as [any]));
					return {
						where: (...whereArgs: unknown[]) => {
							const whereResult = fromResult.where(...(whereArgs as [any]));
							return {
								then: (onfulfilled: any, onrejected: any) => {
									activeQueries++;
									maxConcurrentQueries = Math.max(maxConcurrentQueries, activeQueries);
									return new Promise((resolve) => setTimeout(resolve, 5))
										.then(() => whereResult)
										.then(
											(val: any) => {
												activeQueries--;
												return onfulfilled(val);
											},
											(err: any) => {
												activeQueries--;
												if (onrejected) return onrejected(err);
												throw err;
											},
										);
								},
							};
						},
					};
				},
			};
		}) as any);

		await repository.getResolvedMeal({
			mealDate: "2026-10-08",
			mealSlot: "lunch",
		});

		selectSpy.mockRestore();
		// 4 parallel queries were launched
		expect(maxConcurrentQueries).toBe(4);
	});
});
