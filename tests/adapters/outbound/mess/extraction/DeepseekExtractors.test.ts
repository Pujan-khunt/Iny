import { describe, it, expect, vi } from "vitest";
import OpenAI from "openai";
import { DeepseekVisionExtractor } from "../../../../../src/adapters/outbound/mess/extraction/DeepseekVisionExtractor";
import { DeepseekTextExtractor } from "../../../../../src/adapters/outbound/mess/extraction/DeepseekTextExtractor";
import {
	LLMError,
	LLMRateLimitError,
	LLMResponseError,
	LLMServerOverloadedError,
} from "../../../../../src/core/errors/LLMErrors";

function createMockOpenAI(createResponseFn: (...args: any[]) => any): OpenAI {
	return {
		chat: {
			completions: {
				create: vi.fn(createResponseFn),
			},
		},
	} as unknown as OpenAI;
}

const sample21Meals = {
	vendor: "cheftalk_regular",
	meals: Array.from({ length: 21 }, (_, i) => ({
		mealDate: `2026-10-${String(4 + Math.floor(i / 3)).padStart(2, "0")}`,
		mealSlot: ["breakfast", "lunch", "dinner"][i % 3],
		items: ["Item 1", "Item 2"],
	})),
};

describe("DeepseekExtractors", () => {
	describe("DeepseekVisionExtractor", () => {
		it("retains raw Frycrums while normalizing the reviewed menu with correction audit", async () => {
			const payload = structuredClone(sample21Meals);
			payload.meals[0].items = ["Frycrums"];
			const client = createMockOpenAI(async () => ({
				choices: [{ message: { content: JSON.stringify(payload) } }],
			}));
			const result = await new DeepseekVisionExtractor(
				client,
				"manual-test-model",
			).extractWeeklyMenu(new Uint8Array([1]));
			expect(result.rawMenu.meals[0].items).toEqual(["Frycrums"]);
			expect(result.menu.meals[0].items).toEqual(["Fryums"]);
			expect(result.corrections).toHaveLength(1);
			result.menu.meals[0].items[0] = "Operator dish";
			expect(result.rawMenu.meals[0].items).toEqual(["Frycrums"]);
			expect(result.corrections[0].originalItem).toBe("Frycrums");
		});

		it("extracts weekly menu from image buffer successfully", async () => {
			const mockClient = createMockOpenAI(async (params: any) => {
				// Assert message payload contains base64 image data url
				expect(params.messages[1].content[1].image_url.url).toContain("data:image/png;base64,");
				expect(params.model).toBe("manual-test-model");
				expect(params.messages[0].content).toContain("Preserve source dish spelling exactly");
				return {
					choices: [
						{
							message: {
								content: JSON.stringify(sample21Meals),
							},
						},
					],
				};
			});

			const extractor = new DeepseekVisionExtractor(mockClient, "manual-test-model");
			const fakeImage = Buffer.from("fake_image_bytes");
			const result = await extractor.extractWeeklyMenu(fakeImage);

			expect(result.menu.vendor).toBe("cheftalk_regular");
			expect(result.menu.meals.length).toBe(21);
			expect(result.menu.meals[0].mealDate).toBe("2026-10-04");
		});

		it("strips markdown code blocks around JSON response", async () => {
			const mockClient = createMockOpenAI(async () => ({
				choices: [
					{
						message: {
							content: `\`\`\`json\n${JSON.stringify(sample21Meals)}\n\`\`\``,
						},
					},
				],
			}));

			const extractor = new DeepseekVisionExtractor(mockClient, "manual-test-model");
			const result = await extractor.extractWeeklyMenu(Buffer.from("img"));
			expect(result.menu.vendor).toBe("cheftalk_regular");
			expect(result.menu.meals.length).toBe(21);
		});

		it("includes optional textContext in extraction prompt", async () => {
			let passedPrompt = "";
			const mockClient = createMockOpenAI(async (params: any) => {
				passedPrompt = params.messages[1].content[0].text;
				return {
					choices: [{ message: { content: JSON.stringify(sample21Meals) } }],
				};
			});

			const extractor = new DeepseekVisionExtractor(mockClient, "manual-test-model");
			await extractor.extractWeeklyMenu(Buffer.from("img"), {
				textContext: "Weekly Menu Oct 4 - 10 Cheftalk",
			});

			expect(passedPrompt).toContain("Weekly Menu Oct 4 - 10 Cheftalk");
		});

		it("throws error when JSON does not adhere to 21-meals schema", async () => {
			const invalidMeals = {
				vendor: "cheftalk_regular",
				meals: [{ mealDate: "2026-10-04", mealSlot: "breakfast", items: ["Poha"] }],
			};
			const mockClient = createMockOpenAI(async () => ({
				choices: [{ message: { content: JSON.stringify(invalidMeals) } }],
			}));

			const extractor = new DeepseekVisionExtractor(mockClient, "manual-test-model");
			await expect(extractor.extractWeeklyMenu(Buffer.from("img"))).rejects.toThrow();
		});

		it("classifies HTTP 429 as LLMRateLimitError", async () => {
			const mockClient = createMockOpenAI(async () => {
				const error: any = new Error("Rate limit exceeded");
				error.status = 429;
				throw error;
			});

			const extractor = new DeepseekVisionExtractor(mockClient, "manual-test-model");
			await expect(extractor.extractWeeklyMenu(Buffer.from("img"))).rejects.toThrow(
				LLMRateLimitError,
			);
		});

		it("classifies HTTP 503 as LLMServerOverloadedError and network timeouts as LLMError", async () => {
			const mockClient503 = createMockOpenAI(async () => {
				const error: any = new Error("Service Unavailable");
				error.status = 503;
				throw error;
			});

			const extractor503 = new DeepseekVisionExtractor(mockClient503, "manual-test-model");
			await expect(extractor503.extractWeeklyMenu(Buffer.from("img"))).rejects.toThrow(
				LLMServerOverloadedError,
			);

			const mockClientTimeout = createMockOpenAI(async () => {
				const error: any = new Error("Connection timeout");
				error.code = "ETIMEDOUT";
				throw error;
			});

			const extractorTimeout = new DeepseekVisionExtractor(mockClientTimeout, "manual-test-model");
			await expect(extractorTimeout.extractWeeklyMenu(Buffer.from("img"))).rejects.toThrow(
				LLMError,
			);
		});
	});

	describe("DeepseekTextExtractor", () => {
		it.each([
			{
				field: "location",
				value: {
					mealDate: "2026-10-08",
					mealSlot: "lunch",
					hostelBatches: ["2028", "2029"],
					collegeBatches: ["ALL_OTHER_BATCHES"],
				},
			},
			{
				field: "timingExtensions",
				value: [
					{
						mealDate: "2026-10-08",
						mealSlot: "dinner",
						targetVendor: null,
						extendedTimings: "Extended until 10:45 PM due to college fest",
					},
				],
			},
			{
				field: "mealChanges",
				value: [
					{
						mealDate: "2026-10-08",
						mealSlot: "lunch",
						targetVendor: "cheftalk_regular",
						changeType: "replacement",
						affectedItem: "Kadai Paneer",
						originalItem: "Paneer Butter Masala",
					},
				],
			},
		])("extracts $field through the production composite API", async ({ field, value }) => {
			const payload = {
				mealDate: "2026-10-08",
				location: null,
				timingExtensions: [],
				mealChanges: [],
				mealSwaps: [],
				[field]: value,
			};
			const mockClient = createMockOpenAI(async (params: any) => {
				expect(params.messages[1].content).toContain("2026-10-08");
				expect(params.model).toBe("manual-test-model");
				return { choices: [{ message: { content: JSON.stringify(payload) } }] };
			});
			const extractor = new DeepseekTextExtractor(mockClient, "manual-test-model");
			const result = await extractor.extractAnnouncementEvents(
				"Meal announcement today",
				new Date("2026-10-08T06:00:00Z"),
			);
			expect(result[field as keyof typeof result]).toEqual(value);
		});

		it("translates bad gateway errors through the composite API", async () => {
			const client = createMockOpenAI(async () => {
				throw { status: 502, message: "Bad gateway" };
			});
			await expect(
				new DeepseekTextExtractor(client, "manual-test-model").extractAnnouncementEvents(
					"text",
					new Date(),
				),
			).rejects.toThrow(LLMError);
		});

		describe("extractAnnouncementEvents", () => {
			it("extracts multi-event combo message (location + timing extension)", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: JSON.stringify({
												mealDate: "2026-10-20",
												location: {
													mealDate: "2026-10-20",
													mealSlot: "lunch",
													hostelBatches: ["2028", "2029"],
													collegeBatches: ["ALL_OTHER_BATCHES"],
												},
												timingExtensions: [
													{
														mealDate: "2026-10-20",
														mealSlot: "lunch",
														targetVendor: null,
														extendedTimings: "Extended till 15:00",
													},
												],
												mealChanges: [],
												mealSwaps: [],
											}),
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const result = await extractor.extractAnnouncementEvents(
					"Lunch extended till 3:00 PM. 2028 and 2029 will have lunch in Hostel, others in College.",
					new Date("2026-10-20T08:00:00Z"),
				);

				expect(result.mealDate).toBe("2026-10-20");
				expect(result.location?.hostelBatches).toEqual(["2028", "2029"]);
				expect(result.location?.collegeBatches).toEqual(["ALL_OTHER_BATCHES"]);
				expect(result.timingExtensions[0].extendedTimings).toBe("Extended till 15:00");
				expect(result.mealSwaps).toEqual([]);
				expect(mockOpenAi.chat.completions.create).toHaveBeenCalledWith(
					expect.objectContaining({
						temperature: 0.0,
						response_format: { type: "json_object" },
					}),
				);
			});

			it("extracts early start timing and location from announcement text with date notation", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockImplementation(async (opts) => {
								expect(opts.messages[0].content).toContain("early start times");
								expect(opts.messages[0].content).toContain("DD/MM/YY");
								return {
									choices: [
										{
											message: {
												content: JSON.stringify({
													mealDate: "2026-10-20",
													location: {
														mealDate: "2026-10-20",
														mealSlot: "lunch",
														hostelBatches: ["ALL_BATCHES"],
														collegeBatches: [],
													},
													timingExtensions: [
														{
															mealDate: "2026-10-20",
															mealSlot: "lunch",
															targetVendor: null,
															extendedTimings: "From 12:00 PM",
														},
													],
													mealChanges: [],
													mealSwaps: [],
												}),
											},
										},
									],
								};
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const result = await extractor.extractAnnouncementEvents(
					"Tommorow (20/10/26), lunch will be arranged in the hostel for all batches. Lunch will be arranged from 12 PM tommorow.",
					new Date("2026-10-19T10:00:00Z"),
				);

				expect(result.mealDate).toBe("2026-10-20");
				expect(result.location?.hostelBatches).toEqual(["ALL_BATCHES"]);
				expect(result.timingExtensions).toHaveLength(1);
				expect(result.timingExtensions[0].extendedTimings).toBe("From 12:00 PM");
			});

			it("extracts meal swap reference relative to receivedAt", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: JSON.stringify({
												mealDate: "2026-10-20",
												location: null,
												timingExtensions: [],
												mealChanges: [],
												mealSwaps: [
													{
														targetMealDate: "2026-10-20",
														targetMealSlot: "dinner",
														sourceMealDate: "2026-10-21",
														sourceMealSlot: "lunch",
														targetVendor: null,
													},
												],
											}),
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const result = await extractor.extractAnnouncementEvents(
					"Today's dinner will serve tomorrow's lunch menu.",
					new Date("2026-10-20T10:00:00Z"),
				);

				expect(result.mealSwaps).toHaveLength(1);
				expect(result.mealSwaps[0].targetMealDate).toBe("2026-10-20");
				expect(result.mealSwaps[0].targetMealSlot).toBe("dinner");
				expect(result.mealSwaps[0].sourceMealDate).toBe("2026-10-21");
				expect(result.mealSwaps[0].sourceMealSlot).toBe("lunch");
			});

			it("extracts combo message with dish change and cleans markdown fences", async () => {
				const comboPayload = {
					mealDate: "2026-10-20",
					location: null,
					timingExtensions: [
						{
							mealDate: "2026-10-20",
							mealSlot: "lunch",
							targetVendor: "cheftalk_regular",
							extendedTimings: "Extended till 14:30",
						},
					],
					mealChanges: [
						{
							mealDate: "2026-10-20",
							mealSlot: "lunch",
							targetVendor: "cheftalk_regular",
							changeType: "replacement",
							affectedItem: "Kadai Paneer",
							originalItem: "Paneer Butter Masala",
						},
					],
					mealSwaps: [],
				};

				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: `\`\`\`json\n${JSON.stringify(comboPayload)}\n\`\`\``,
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const result = await extractor.extractAnnouncementEvents(
					"Lunch extended till 2:30 PM. Paneer Butter Masala replaced with Kadai Paneer at Cheftalk Regular.",
					new Date("2026-10-20T07:00:00Z"),
				);

				expect(result.mealDate).toBe("2026-10-20");
				expect(result.location).toBeNull();
				expect(result.timingExtensions).toHaveLength(1);
				expect(result.mealChanges).toHaveLength(1);
				expect(result.mealChanges[0].affectedItem).toBe("Kadai Paneer");
			});

			it("wraps 429 rate limit errors as LLMRateLimitError", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockRejectedValue({ status: 429, message: "Rate limit hit" }),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				await expect(
					extractor.extractAnnouncementEvents("Lunch announcement", new Date()),
				).rejects.toThrow(LLMRateLimitError);
			});

			it("wraps 503 errors as LLMServerOverloadedError", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockRejectedValue({ status: 503, message: "Service unavailable" }),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				await expect(
					extractor.extractAnnouncementEvents("Lunch announcement", new Date()),
				).rejects.toThrow(LLMServerOverloadedError);
			});

			it("uses the injected model and original timestamp", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: JSON.stringify({
												mealDate: "2026-10-20",
												location: null,
												timingExtensions: [],
												mealChanges: [],
												mealSwaps: [],
											}),
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const result = await extractor.extractAnnouncementEvents(
					"Simple notice",
					new Date("2026-10-20T20:00:00Z"),
				);
				expect(result.mealDate).toBe("2026-10-20");
				expect(mockOpenAi.chat.completions.create).toHaveBeenCalled();
			});

			it("throws LLMError when LLM returns empty content", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [{ message: { content: null } }],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				await expect(
					extractor.extractAnnouncementEvents("Announcement", new Date("2026-10-20T20:00:00Z")),
				).rejects.toThrow(LLMError);
			});

			it("throws LLMResponseError with rawResponse attached when JSON does not match schema", async () => {
				const rawInvalidJson = JSON.stringify({
					mealDate: "2026-10-21",
					location: {
						mealSlot: "invalid-meal-slot",
					},
				});
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: rawInvalidJson,
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				let caughtErr: any;
				try {
					await extractor.extractAnnouncementEvents("Announcement", new Date());
				} catch (err) {
					caughtErr = err;
				}

				expect(caughtErr).toBeInstanceOf(LLMResponseError);
				expect(caughtErr.rawResponse).toBe(rawInvalidJson);
			});

			it("normalizes missing mealDate in location using root mealDate", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: JSON.stringify({
												mealDate: "2026-10-21",
												location: {
													mealSlot: "lunch",
													hostelBatches: ["ALL_BATCHES"],
													collegeBatches: [],
												},
												timingExtensions: [],
												mealChanges: [],
												mealSwaps: [],
											}),
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const result = await extractor.extractAnnouncementEvents(
					"Lunch in hostel for all batches",
					new Date("2026-10-20T20:00:00Z"),
				);
				expect(result.mealDate).toBe("2026-10-21");
				expect(result.location?.mealDate).toBe("2026-10-21");
				expect(result.location?.mealSlot).toBe("lunch");
				expect(result.location?.hostelBatches).toEqual(["ALL_BATCHES"]);
			});

			it("normalizes missing mealDate in timingExtensions and mealChanges", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: JSON.stringify({
												mealDate: "2026-10-21",
												location: null,
												timingExtensions: [
													{
														mealSlot: "lunch",
														targetVendor: null,
														extendedTimings: "From 12:00 PM",
													},
												],
												mealChanges: [
													{
														mealSlot: "lunch",
														targetVendor: "cheftalk_regular",
														changeType: "replacement",
														affectedItem: "Kadai Paneer",
														originalItem: "Paneer Butter Masala",
													},
												],
												mealSwaps: [],
											}),
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const result = await extractor.extractAnnouncementEvents(
					"Timing and meal change",
					new Date("2026-10-20T20:00:00Z"),
				);
				expect(result.timingExtensions[0].mealDate).toBe("2026-10-21");
				expect(result.mealChanges[0].mealDate).toBe("2026-10-21");
			});

			it("normalizes malformed non-ISO mealDate string to reference IST date", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: JSON.stringify({
												mealDate: "today", // Malformed non-ISO date
												location: null,
												timingExtensions: [],
												mealChanges: [],
												mealSwaps: [],
											}),
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const refDate = new Date("2026-10-21T06:00:00Z");
				const result = await extractor.extractAnnouncementEvents("Lunch notice", refDate);
				expect(result.mealDate).toBe("2026-10-21");
			});

			it("normalizes missing targetMealDate in mealSwaps using top-level mealDate", async () => {
				const mockOpenAi = {
					chat: {
						completions: {
							create: vi.fn().mockResolvedValue({
								choices: [
									{
										message: {
											content: JSON.stringify({
												mealDate: "2026-10-20",
												location: null,
												timingExtensions: [],
												mealChanges: [],
												mealSwaps: [
													{
														targetMealSlot: "dinner",
														sourceMealDate: "2026-10-21",
														sourceMealSlot: "lunch",
														targetVendor: "cheftalk_regular",
													},
												],
											}),
										},
									},
								],
							}),
						},
					},
				};

				const extractor = new DeepseekTextExtractor(mockOpenAi as any, "manual-test-model");
				const result = await extractor.extractAnnouncementEvents(
					"Swap announcement",
					new Date("2026-10-20T20:00:00Z"),
				);
				expect(result.mealSwaps[0].targetMealDate).toBe("2026-10-20");
			});
		});
	});
});
