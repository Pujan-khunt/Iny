import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryMessDetailsTool } from "../../src/tools/QueryMessDetailsTool.js";
import { MessRepositoryPort } from "../../src/core/ports/MessRepositoryPort.js";
import { ResolvedMealInfo } from "../../src/core/entities/MessMeal.js";

describe("QueryMessDetailsTool", () => {
	let mockMessRepo: MessRepositoryPort;

	const sampleResolved: ResolvedMealInfo = {
		mealDate: "2026-10-08",
		mealSlot: "lunch",
		meals: [
			{
				id: "m-1",
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				vendor: "cheftalk_regular",
				items: ["Paneer Butter Masala", "Jeera Rice"],
				ingestedAt: new Date(),
			},
		],
		locationDetail: null,
		timingExtensions: [],
		mealChanges: [],
	};

	beforeEach(() => {
		mockMessRepo = {
			getResolvedMeal: vi.fn().mockResolvedValue(sampleResolved),
		};
	});

	it("exposes definition with correct name and non-terminal execution", async () => {
		const tool = new QueryMessDetailsTool(mockMessRepo);
		expect(tool.name).toBe("query_mess_details");
		expect(tool.description).toBeDefined();

		const result = await tool.execute({
			mealDate: "2026-10-08",
			mealSlot: "lunch",
		});

		expect(result.isTerminal).toBe(false);
		expect(result.content).toBe(JSON.stringify(sampleResolved));
		expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			vendor: undefined,
		});
	});

	it("defaults mealDate to IST date if omitted", async () => {
		const fixedNow = new Date("2026-10-08T06:30:00Z"); // 12:00 PM IST on 2026-10-08
		const tool = new QueryMessDetailsTool(mockMessRepo, () => fixedNow);

		const result = await tool.execute({
			mealSlot: "dinner",
		});

		expect(result.isTerminal).toBe(false);
		expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
			mealDate: "2026-10-08",
			mealSlot: "dinner",
			vendor: undefined,
		});
	});

	it("passes vendor filter when provided", async () => {
		const tool = new QueryMessDetailsTool(mockMessRepo);

		await tool.execute({
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			vendor: "cheftalk_regular",
		});

		expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			vendor: "cheftalk_regular",
		});
	});
});
