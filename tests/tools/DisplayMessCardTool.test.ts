import { describe, it, expect, vi, beforeEach } from "vitest";
import { DisplayMessCardTool } from "../../src/tools/DisplayMessCardTool";
import { MessRepositoryPort } from "../../src/core/ports/MessRepositoryPort";
import { ResolvedMealInfo, MessMeal } from "../../src/core/entities/MessMeal";
import { defaultMessCardPresenter } from "../../src/adapters/outbound/mess/formatting/MessCardRenderer";

describe("DisplayMessCardTool", () => {
	let mockMessRepo: MessRepositoryPort;

	const sampleMeals: MessMeal[] = [
		{
			id: "m-1",
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			vendor: "cheftalk_regular",
			items: ["Rajma", "Rice", "Roti"],
			ingestedAt: new Date(),
		},
		{
			id: "m-2",
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			vendor: "cheftalk_jain",
			items: ["Dal", "Rice", "Roti"],
			ingestedAt: new Date(),
		},
		{
			id: "m-3",
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			vendor: "tcb",
			items: ["Chole", "Bhature"],
			ingestedAt: new Date(),
		},
	];

	const defaultResolved: ResolvedMealInfo = {
		mealDate: "2026-10-08",
		mealSlot: "lunch",
		meals: sampleMeals,
		locationDetail: {
			id: "loc-1",
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			hostelBatches: [],
			collegeBatches: ["ALL_BATCHES"],
			ingestedAt: new Date(),
		},
		timingExtensions: [],
		mealChanges: [],
	};

	beforeEach(() => {
		mockMessRepo = {
			getResolvedMeal: vi.fn().mockResolvedValue(defaultResolved),
		};
	});

	it("exposes definition with correct name and schema", () => {
		const tool = new DisplayMessCardTool(mockMessRepo, defaultMessCardPresenter);
		expect(tool.name).toBe("display_mess_card");
		expect(tool.description).toContain("Serves 95% of standard meal and location lookups");
		expect(tool.definition.name).toBe("display_mess_card");
	});

	describe("Quadrant 1: Multi-Vendor Slot Digest", () => {
		it("executes Q1 when mealSlot is provided and vendor is omitted", async () => {
			// 12:00 PM IST on 2026-10-08
			const noonIST = new Date("2026-10-08T06:30:00Z");
			const tool = new DisplayMessCardTool(mockMessRepo, defaultMessCardPresenter, () => noonIST);

			const result = await tool.execute({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toContain("🍽️ *Lunch Menu* (Thu, 8 Oct)");
			expect(result.content).toContain("🍛 *Cheftalk Regular:* Rajma, Rice, Roti");
			expect(result.content).toContain("📍 *Location:* College (All batches)");
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				vendor: undefined,
			});
		});

		it("marks meal as (Ended) when queried after cutoff", async () => {
			// 03:00 PM IST on 2026-10-08 (lunch ended at 02:30 PM)
			const postLunchIST = new Date("2026-10-08T09:30:00Z");
			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				() => postLunchIST,
			);

			const result = await tool.execute({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toContain("*(Ended)*");
		});
	});

	describe("Quadrant 2: Single-Vendor Slot Detail", () => {
		it("executes Q2 when both mealSlot and vendor are provided", async () => {
			const noonIST = new Date("2026-10-08T06:30:00Z");
			const tool = new DisplayMessCardTool(mockMessRepo, defaultMessCardPresenter, () => noonIST);

			const result = await tool.execute({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				vendor: "cheftalk_regular",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toContain("🍽️ *Lunch — Cheftalk Regular* (Thu, 8 Oct)");
			expect(result.content).toContain("• Rajma\n• Rice\n• Roti");
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				vendor: "cheftalk_regular",
			});
		});
	});

	describe("Quadrant 3: Slot & Vendor Omitted (Next Upcoming Rollover)", () => {
		it("resolves active slot to lunch when queried at 10:00 AM IST", async () => {
			// 10:00 AM IST on 2026-10-08 (breakfast closed at 09:30, resolves to lunch)
			const tenAmIST = new Date("2026-10-08T04:30:00Z");
			const tool = new DisplayMessCardTool(mockMessRepo, defaultMessCardPresenter, () => tenAmIST);

			const result = await tool.execute({});

			expect(result.isTerminal).toBe(true);
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				vendor: undefined,
			});
		});

		it("rolls over to next day breakfast when queried at 10:00 PM IST", async () => {
			// 10:00 PM IST on 2026-10-08 (dinner closed at 09:30 PM, rolls over to tomorrow breakfast)
			const tenPmIST = new Date("2026-10-08T16:30:00Z");
			const tool = new DisplayMessCardTool(mockMessRepo, defaultMessCardPresenter, () => tenPmIST);

			await tool.execute({});

			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-09",
				mealSlot: "breakfast",
				vendor: undefined,
			});
		});
	});

	describe("Quadrant 4: Single-Vendor Full-Day Digest", () => {
		it("executes Q4 when mealSlot is omitted and vendor is provided", async () => {
			const morningIST = new Date("2026-10-08T03:30:00Z"); // 09:00 AM IST
			const fullDayResolved: ResolvedMealInfo = {
				mealDate: "2026-10-08",
				mealSlot: null,
				meals: [
					{
						id: "m-1",
						mealDate: "2026-10-08",
						mealSlot: "breakfast",
						vendor: "tcb",
						items: ["Poha"],
						ingestedAt: new Date(),
					},
					{
						id: "m-2",
						mealDate: "2026-10-08",
						mealSlot: "lunch",
						vendor: "tcb",
						items: ["Chole"],
						ingestedAt: new Date(),
					},
					{
						id: "m-3",
						mealDate: "2026-10-08",
						mealSlot: "dinner",
						vendor: "tcb",
						items: ["Biryani"],
						ingestedAt: new Date(),
					},
				],
				locationDetail: null,
				timingExtensions: [],
				mealChanges: [],
			};
			vi.mocked(mockMessRepo.getResolvedMeal).mockResolvedValue(fullDayResolved);

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				() => morningIST,
			);
			const result = await tool.execute({
				vendor: "tcb",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toContain("🍽️ *TCB (Uniworld) — Full Day Menu* (Thu, 8 Oct)");
			expect(result.content).toContain("🌅 *Breakfast:* Poha");
			expect(result.content).toContain("🍛 *Lunch:* Chole");
			expect(result.content).toContain("🌙 *Dinner:* Biryani");
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				vendor: "tcb",
				mealSlot: undefined,
			});
		});
	});

	describe("Fallback and Error Handling", () => {
		it("returns non-terminal message when no meals are scheduled", async () => {
			vi.mocked(mockMessRepo.getResolvedMeal).mockResolvedValue({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				meals: [],
				locationDetail: null,
				timingExtensions: [],
				mealChanges: [],
			});

			const noonIST = new Date("2026-10-08T06:30:00Z");
			const tool = new DisplayMessCardTool(mockMessRepo, defaultMessCardPresenter, () => noonIST);

			const result = await tool.execute({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
			});

			expect(result.isTerminal).toBe(false);
			expect(result.content).toContain("No menu scheduled");
		});

		it("returns error when invalid mealDate format is provided", async () => {
			const tool = new DisplayMessCardTool(mockMessRepo, defaultMessCardPresenter);
			const result = await tool.execute({
				mealDate: "08-10-2026",
			});

			expect(result.isTerminal).toBe(false);
			expect(result.content).toContain("Error: Invalid tool arguments");
		});
	});
});
