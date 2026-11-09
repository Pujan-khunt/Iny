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
		expect(tool.description).toContain("upcoming meal rollover");
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
			expect(result.content).toContain("🍽️ *Lunch Menu*\n📅 Today, Thu, 8 Oct");
			expect(result.content).toContain("🍛 *Cheftalk:*\n• Rajma\n• Rice\n• Roti");
			expect(result.content).toContain("📍 *Location:* College (All batches)");
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				vendor: undefined,
			});
		});

		it("executes Q1 multi-vendor slot digest when mealSlot is provided and vendor is omitted even if accessControl is present", async () => {
			const noonIST = new Date("2026-10-08T06:30:00Z");
			const mockAccess = {
				authenticate: vi.fn(),
				getUser: vi.fn().mockResolvedValue({
					phoneNumber: "919876543210",
					defaultVendor: "tcb",
				}),
				setDefaultVendor: vi.fn(),
			};

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				mockAccess as any,
				() => noonIST,
			);

			const result = await tool.execute(
				{
					mealDate: "2026-10-08",
					mealSlot: "lunch",
				},
				{ userId: "919876543210" },
			);

			expect(result.isTerminal).toBe(true);
			expect(result.content).toContain("🍽️ *Lunch Menu*");
			expect(result.content).toContain("🍛 *Cheftalk:*");
			expect(result.content).toContain("☕ *TCB:*");
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
			expect(result.content).toContain("🍽️ *Cheftalk Lunch*\n📅 Today, Thu, 8 Oct");
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

		it("resolves vendor from caller's database defaultVendor when accessControl is present", async () => {
			const noonIST = new Date("2026-10-08T06:30:00Z");
			const mockAccess = {
				authenticate: vi.fn(),
				getUser: vi.fn().mockResolvedValue({
					phoneNumber: "919876543210",
					defaultVendor: "tcb",
				}),
				setDefaultVendor: vi.fn(),
			};

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				mockAccess as any,
				() => noonIST,
			);

			const result = await tool.execute({}, { userId: "919876543210" });
			expect(result.isTerminal).toBe(true);
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				vendor: "tcb",
			});
		});

		it("defaults to cheftalk_regular when caller has no defaultVendor in database", async () => {
			const noonIST = new Date("2026-10-08T06:30:00Z");
			const mockAccess = {
				authenticate: vi.fn(),
				getUser: vi.fn().mockResolvedValue(null),
				setDefaultVendor: vi.fn(),
			};

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				mockAccess as any,
				() => noonIST,
			);

			const result = await tool.execute({}, { userId: "unknown-user" });
			expect(result.isTerminal).toBe(true);
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				vendor: "cheftalk_regular",
			});
		});
	});

	describe("Single-Vendor Upcoming Slot Normalization", () => {
		it("resolves next upcoming meal slot when mealSlot is omitted for a vendor", async () => {
			// 16:00 IST on 2026-10-08 (lunch has ended, dinner is next)
			const afternoonIST = new Date("2026-10-08T10:30:00Z");
			const dinnerResolved: ResolvedMealInfo = {
				mealDate: "2026-10-08",
				mealSlot: "dinner",
				meals: [
					{
						id: "m-dinner",
						mealDate: "2026-10-08",
						mealSlot: "dinner",
						vendor: "cheftalk_regular",
						items: ["Paneer Butter Masala", "Roti", "Jeera Rice"],
						ingestedAt: new Date(),
					},
				],
				locationDetail: {
					id: "loc-dinner",
					mealDate: "2026-10-08",
					mealSlot: "dinner",
					hostelBatches: [],
					collegeBatches: ["ALL_BATCHES"],
					ingestedAt: new Date(),
				},
				timingExtensions: [],
				mealChanges: [],
			};
			vi.mocked(mockMessRepo.getResolvedMeal).mockResolvedValue(dinnerResolved);

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				() => afternoonIST,
			);
			const result = await tool.execute({
				vendor: "cheftalk_regular",
			});

			expect(result.isTerminal).toBe(true);
			// Verifies single vendor slot detail is rendered, NOT full day digest
			expect(result.content).toContain("🍽️ *Cheftalk Dinner*\n📅 Today, Thu, 8 Oct");
			expect(result.content).toContain("• Paneer Butter Masala");
			expect(result.content).not.toContain("Full Day Menu");
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				mealSlot: "dinner",
				vendor: "cheftalk_regular",
			});
		});
	});

	describe("Quadrant 4: Single-Vendor Full-Day Digest (mealSlot: 'all')", () => {
		const fullDayResolved: ResolvedMealInfo = {
			mealDate: "2026-10-08",
			mealSlot: null,
			meals: [
				{
					id: "m-b",
					mealDate: "2026-10-08",
					mealSlot: "breakfast",
					vendor: "cheftalk_regular",
					items: ["Poha", "Tea"],
					ingestedAt: new Date(),
				},
				{
					id: "m-l",
					mealDate: "2026-10-08",
					mealSlot: "lunch",
					vendor: "cheftalk_regular",
					items: ["Rajma", "Rice"],
					ingestedAt: new Date(),
				},
				{
					id: "m-d",
					mealDate: "2026-10-08",
					mealSlot: "dinner",
					vendor: "cheftalk_regular",
					items: ["Paneer", "Roti"],
					ingestedAt: new Date(),
				},
			],
			locationDetail: null,
			timingExtensions: [],
			mealChanges: [],
		};

		it("renders full day digest across all slots when mealSlot is 'all'", async () => {
			const morningIST = new Date("2026-10-08T02:30:00Z"); // 08:00 AM IST
			vi.mocked(mockMessRepo.getResolvedMeal).mockResolvedValue(fullDayResolved);

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				() => morningIST,
			);
			const result = await tool.execute({
				mealDate: "2026-10-08",
				vendor: "cheftalk_regular",
				mealSlot: "all",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toContain("🍽️ *Cheftalk Full Day Menu*\n📅 Today, Thu, 8 Oct");
			expect(result.content).toContain("🌅 *Breakfast:*\n• Poha\n• Tea");
			expect(result.content).toContain("🍛 *Lunch:*\n• Rajma\n• Rice");
			expect(result.content).toContain("🌙 *Dinner:*\n• Paneer\n• Roti");
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				vendor: "cheftalk_regular",
				mealSlot: undefined,
			});
		});

		it("resolves vendor from caller defaultVendor when mealSlot is 'all' and vendor is omitted", async () => {
			const morningIST = new Date("2026-10-08T02:30:00Z");
			const tcbFullDay: ResolvedMealInfo = {
				...fullDayResolved,
				meals: [
					{
						id: "m-tcb-1",
						mealDate: "2026-10-08",
						mealSlot: "breakfast",
						vendor: "tcb",
						items: ["Idli"],
						ingestedAt: new Date(),
					},
				],
			};
			vi.mocked(mockMessRepo.getResolvedMeal).mockResolvedValue(tcbFullDay);

			const mockAccess = {
				authenticate: vi.fn(),
				getUser: vi.fn().mockResolvedValue({ phoneNumber: "919876543210", defaultVendor: "tcb" }),
				setDefaultVendor: vi.fn(),
			};

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				mockAccess as any,
				() => morningIST,
			);
			const result = await tool.execute(
				{ mealDate: "2026-10-08", mealSlot: "all" },
				{ userId: "919876543210" },
			);

			expect(result.isTerminal).toBe(true);
			expect(result.content).toContain("🍽️ *TCB Full Day Menu*");
			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-08",
				vendor: "tcb",
				mealSlot: undefined,
			});
		});

		it("returns deterministic empty notice when no meals are loaded for requested vendor full day", async () => {
			const morningIST = new Date("2026-10-08T02:30:00Z");
			vi.mocked(mockMessRepo.getResolvedMeal).mockResolvedValue({
				mealDate: "2026-10-08",
				mealSlot: null,
				meals: [],
				locationDetail: null,
				timingExtensions: [],
				mealChanges: [],
			});

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				() => morningIST,
			);
			const result = await tool.execute({
				mealDate: "2026-10-08",
				vendor: "cheftalk_regular",
				mealSlot: "all",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toBe(
				"ℹ️ No menu data is currently loaded for Cheftalk on Today, Thursday, 8th Oct.",
			);
		});
	});

	describe("Fallback and Error Handling", () => {
		it("returns deterministic terminal notice when no meals are loaded for requested slot", async () => {
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

			expect(result.isTerminal).toBe(true);
			expect(result.content).toBe(
				"ℹ️ No menu data is currently loaded for the mess lunch on Today, Thursday, 8th Oct.",
			);
		});

		it("returns deterministic terminal notice when no meals are loaded for single-vendor slot", async () => {
			vi.mocked(mockMessRepo.getResolvedMeal).mockResolvedValue({
				mealDate: "2026-11-01",
				mealSlot: "breakfast",
				meals: [],
				locationDetail: null,
				timingExtensions: [],
				mealChanges: [],
			});

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				() => new Date("2026-10-31T17:53:00Z"),
			);
			const result = await tool.execute({
				mealDate: "2026-11-01",
				mealSlot: "breakfast",
				vendor: "cheftalk_regular",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toBe(
				"ℹ️ No menu data is currently loaded for Cheftalk breakfast on Tomorrow, Sunday, 1st Nov.",
			);
		});

		it("returns deterministic terminal notice when no meals are loaded for upcoming single-vendor slot", async () => {
			vi.mocked(mockMessRepo.getResolvedMeal).mockResolvedValue({
				mealDate: "2026-11-01",
				mealSlot: "breakfast",
				meals: [],
				locationDetail: null,
				timingExtensions: [],
				mealChanges: [],
			});

			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				() => new Date("2026-10-31T17:53:00Z"),
			);
			const result = await tool.execute({
				mealDate: "2026-11-01",
				vendor: "tcb",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toBe(
				"ℹ️ No menu data is currently loaded for TCB breakfast on Tomorrow, Sunday, 1st Nov.",
			);
		});

		it("resolves upcoming slot to breakfast when a future date is requested during afternoon/evening", async () => {
			// 3:00 PM IST on 2026-10-08 -> today's upcoming slot is dinner
			const afternoonIST = new Date("2026-10-08T09:30:00Z");
			const tool = new DisplayMessCardTool(
				mockMessRepo,
				defaultMessCardPresenter,
				() => afternoonIST,
			);

			await tool.execute({
				mealDate: "2026-10-09",
				vendor: "cheftalk_regular",
			});

			expect(mockMessRepo.getResolvedMeal).toHaveBeenCalledWith({
				mealDate: "2026-10-09",
				mealSlot: "breakfast",
				vendor: "cheftalk_regular",
			});
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
