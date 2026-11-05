import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	FoodAnnouncementSource,
	FoodCandidate,
	SourceEvidence,
} from "../../../src/core/entities/FoodAnnouncement";
import type {
	FoodAssessmentResult,
	FoodFailure,
	FoodLease,
	FoodVerification,
	ValidatedFoodCommit,
} from "../../../src/core/entities/FoodIngestion";
import type { Vendor } from "../../../src/core/entities/MessMeal";
import type { FoodAssessmentPort } from "../../../src/core/ports/FoodAssessmentPort";
import type { FoodIngestionRepositoryPort } from "../../../src/core/ports/FoodIngestionRepositoryPort";
import type { LoggerPort } from "../../../src/core/ports/LoggerPort";
import type { MessStagingRepositoryPort } from "../../../src/core/ports/MessStagingRepositoryPort";
import { MealSwapResolver } from "../../../src/core/services/MealSwapResolver";
import { ProcessNextFoodAnnouncement } from "../../../src/core/use-cases/ProcessNextFoodAnnouncement";

type Assessment = Extract<FoodAssessmentResult, { kind: "candidate" }>;
type Menu = Extract<FoodCandidate, { kind: "weekly_menu" }>;
type Operational = Extract<FoodCandidate, { kind: "operational_announcement" }>;
const verification: FoodVerification = {
	verdict: "accept",
	completeCoverage: true,
	missingFields: [],
	conflictingFields: [],
	unsupportedClauses: [],
};
const source: FoodAnnouncementSource = {
	messageId: "source-original",
	groupJid: "food-group",
	senderAddress: "sender",
	senderAddressType: "pn",
	deliveryMode: "notify",
	originalCreatedAt: new Date("2026-10-31T23:30:00Z"),
	capturedAt: new Date("2026-11-03T00:00:00Z"),
	messageType: "image",
	textBody: null,
	mediaMimeType: "image/png",
	mediaBytes: new Uint8Array([1]),
};
const lease: FoodLease = {
	messageId: source.messageId,
	token: "opaque-fence",
	expiresAt: new Date("2026-11-03T00:05:00Z"),
	attempt: 1,
};
function assessed(candidate: FoodCandidate, evidence: SourceEvidence[]): Assessment {
	return {
		kind: "candidate",
		candidate,
		evidence,
		verification: { ...verification },
		rawExtraction: "literal raw extraction",
		rawVerification: "literal raw verification",
		model: "explicit-test-model",
		promptVersion: "reviewed-v1",
	};
}
function menu(vendor: Vendor = "tcb", vendorQuote = "Uniworld"): Assessment {
	const slots = ["breakfast", "lunch", "dinner"] as const;
	const candidate: Menu = {
		kind: "weekly_menu",
		dateRange: { start: "2026-11-01", end: "2026-11-07" },
		menu: {
			vendor,
			meals: Array.from({ length: 21 }, (_, i) => ({
				mealDate: `2026-11-0${Math.floor(i / 3) + 1}`,
				mealSlot: slots[i % 3],
				items: ["Frycrums (spicy)", "Unfamiliar Dish"],
			})),
		},
	};
	const fields: [string, string][] = [
		["/menu/vendor", vendorQuote],
		["/dateRange/start", "1/11/26"],
		["/dateRange/end", "7/11/26"],
	];
	candidate.menu.meals.forEach((meal, index) => {
		fields.push(
			[`/menu/meals/${index}/mealDate`, meal.mealDate],
			[`/menu/meals/${index}/mealSlot`, meal.mealSlot],
		);
		meal.items.forEach((item, itemIndex) =>
			fields.push([`/menu/meals/${index}/items/${itemIndex}`, item]),
		);
	});
	return assessed(
		candidate,
		fields.map(([fieldPath, rawValue]) => ({
			fieldPath,
			rawValue,
			clause: rawValue,
			location: { kind: "image", page: 1, row: fieldPath, column: "source" },
		})),
	);
}
const locationText = "Today lunch for all batches in hostel";
function textEvidence(
	body: string,
	prefix: string,
	fields: [string, string][],
	clause = body,
): SourceEvidence[] {
	return fields.map(([field, rawValue]) => ({
		fieldPath: `${prefix}/${field}`,
		rawValue,
		clause,
		location: {
			kind: "text",
			start: body.indexOf(rawValue),
			end: body.indexOf(rawValue) + rawValue.length,
		},
	}));
}
function operational(): Assessment {
	const candidate: Operational = {
		kind: "operational_announcement",
		announcement: {
			locations: [
				{
					mealDate: "2026-11-01",
					mealSlot: "lunch",
					hostelBatches: ["ALL_BATCHES"],
					collegeBatches: [],
				},
			],
			timings: [],
			changes: [],
			swaps: [],
		},
	};
	return assessed(
		candidate,
		textEvidence(locationText, "/announcement/locations/0", [
			["mealDate", "Today"],
			["mealSlot", "lunch"],
			["hostelBatches/0", "all batches"],
		]),
	);
}
const swapText = "Today's dinner will serve tomorrow's lunch menu";
function swapAssessment(): Assessment {
	return assessed(
		{
			kind: "operational_announcement",
			announcement: {
				locations: [],
				timings: [],
				changes: [],
				swaps: [
					{
						sourceMealDate: "2026-11-02",
						sourceMealSlot: "lunch",
						targetMealDate: "2026-11-01",
						targetMealSlot: "dinner",
						targetVendor: null,
					},
				],
			},
		},
		textEvidence(swapText, "/announcement/swaps/0", [
			["targetMealDate", "Today"],
			["targetMealSlot", "dinner"],
			["sourceMealDate", "tomorrow"],
			["sourceMealSlot", "lunch"],
		]),
	);
}
function fixture() {
	let persisted: ValidatedFoodCommit | undefined;
	const repository: FoodIngestionRepositoryPort = {
		initialize: vi.fn(),
		capture: vi.fn(),
		claimNext: vi.fn().mockResolvedValue({ source, lease }),
		accept: vi.fn(async (_lease, commit) => {
			persisted = commit;
			return { outcome: "accepted" } as const;
		}),
		reject: vi.fn(
			async (_lease, decision) =>
				({ outcome: "rejected", reason: decision.reason, detail: decision.detail }) as const,
		),
		fail: vi.fn(
			async (_lease, failure) =>
				({ outcome: "failed", reason: failure.code, detail: failure.detail }) as const,
		),
	};
	const assessment: FoodAssessmentPort = { assess: vi.fn().mockResolvedValue(menu()) };
	const staging: MessStagingRepositoryPort = {
		getMealsByDateAndSlot: vi.fn(async (date, slot, vendor) => [
			{
				mealDate: date,
				mealSlot: slot,
				vendor: vendor ?? "tcb",
				items: date === "2026-11-02" ? ["Source Rice"] : ["Target Roti"],
			},
		]),
		getIngestionAudit: vi.fn(),
		stageMessage: vi.fn(),
		listStagedMessages: vi.fn(),
		getMessageById: vi.fn(),
		atomicCommit: vi.fn(),
		atomicCommitComposite: vi.fn(),
		markIgnored: vi.fn(),
		atomicUndo: vi.fn(),
		atomicReset: vi.fn(),
	};
	const logger: LoggerPort = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn(),
	};
	const controller = new AbortController();
	return {
		repository,
		assessment,
		staging,
		logger,
		controller,
		execute: () =>
			new ProcessNextFoodAnnouncement(
				repository,
				assessment,
				new MealSwapResolver(staging),
				logger,
			).execute(controller.signal),
		persisted: () => persisted,
	};
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
	f = fixture();
});
afterEach(() => {
	vi.useRealTimers();
});
function useText(result: Assessment, body: string) {
	vi.mocked(f.repository.claimNext).mockResolvedValue({
		source: {
			...source,
			messageType: "text",
			mediaBytes: null,
			mediaMimeType: null,
			textBody: body,
		},
		lease,
	});
	vi.mocked(f.assessment.assess).mockResolvedValue(result);
}
async function expectRejection(reason?: string) {
	expect(await f.execute()).toMatchObject({ outcome: "rejected", ...(reason ? { reason } : {}) });
	expect(f.persisted()).toBeUndefined();
	expect(f.repository.accept).not.toHaveBeenCalled();
	expect(f.repository.reject).toHaveBeenCalledWith(
		lease,
		expect.objectContaining({ outcome: "rejected" }),
	);
	expect(f.assessment.assess).toHaveBeenCalledTimes(1);
	expect(f.repository.fail).not.toHaveBeenCalled();
}

describe("ProcessNextFoodAnnouncement", () => {
	it("returns null after one empty claim without assessment or finalization", async () => {
		vi.mocked(f.repository.claimNext).mockResolvedValue(null);
		expect(await f.execute()).toBeNull();
		expect(f.repository.claimNext).toHaveBeenCalledTimes(1);
		expect(f.assessment.assess).not.toHaveBeenCalled();
		expect(f.repository.accept).not.toHaveBeenCalled();
		expect(f.repository.reject).not.toHaveBeenCalled();
		expect(f.repository.fail).not.toHaveBeenCalled();
	});
	it("accepts all 21 source-backed slots and preserves raw spelling, responses and correction provenance", async () => {
		const result = menu();
		vi.mocked(f.assessment.assess).mockResolvedValue(result);
		expect(await f.execute()).toEqual({ outcome: "accepted" });
		expect(f.repository.claimNext).toHaveBeenCalledTimes(1);
		expect(f.persisted()).toMatchObject({
			candidate: result.candidate,
			evidence: result.evidence,
			verification,
			rawExtraction: "literal raw extraction",
			rawVerification: "literal raw verification",
			model: "explicit-test-model",
			promptVersion: "reviewed-v1",
			resolvedSwaps: [],
			menuExtraction: {
				rawMenu: (result.candidate as Menu).menu,
				menu: { vendor: "tcb", meals: expect.any(Array) },
				corrections: expect.any(Array),
			},
		});
		const commit = f.persisted()!;
		expect(commit.menuExtraction!.menu.meals).toHaveLength(21);
		expect(commit.menuExtraction!.menu.meals[0].items).toEqual([
			"Fryums (spicy)",
			"Unfamiliar Dish",
		]);
		expect(commit.menuExtraction!.corrections).toHaveLength(21);
		expect(commit.menuExtraction!.corrections[0]).toEqual({
			mealDate: "2026-11-01",
			mealSlot: "breakfast",
			itemIndex: 0,
			originalItem: "Frycrums (spicy)",
			correctedItem: "Fryums (spicy)",
			aliasId: "frycrums-to-fryums",
		});
		expect((result.candidate as Menu).menu.meals[0].items[0]).toBe("Frycrums (spicy)");
		expect(f.repository.reject).not.toHaveBeenCalled();
		expect(f.repository.fail).not.toHaveBeenCalled();
	});
	it.each([
		{ verdict: "uncertain" },
		{ verdict: "reject" },
		{ verdict: "accept", completeCoverage: false },
		{ missingFields: ["item"] },
		{ conflictingFields: ["date"] },
		{ unsupportedClauses: ["instruction"] },
		{ verdict: "accepted" },
		{ completeCoverage: "true" },
	])("rejects verifier condition %j without a repair attempt", async (patch) => {
		const result = menu();
		Object.assign(result.verification, patch);
		vi.mocked(f.assessment.assess).mockResolvedValue(result);
		await expectRejection("ambiguous_content");
		expect(f.repository.reject).toHaveBeenCalledWith(
			lease,
			expect.objectContaining({
				diagnostics: expect.objectContaining({
					candidate: result.candidate,
					evidence: result.evidence,
					verification: result.verification,
					rawExtraction: result.rawExtraction,
					rawVerification: result.rawVerification,
					model: result.model,
					promptVersion: result.promptVersion,
					recognizedType: "weekly_menu",
				}),
			}),
		);
	});
	it.each(["missing slot", "duplicate slot", "unreadable dish"])(
		"rejects weekly coverage despite complete field evidence: %s",
		async (problem) => {
			const result = menu(),
				c = result.candidate as Menu;
			if (problem === "missing slot") c.menu.meals.pop();
			if (problem === "duplicate slot") Object.assign(c.menu.meals[20], c.menu.meals[0]);
			if (problem === "unreadable dish") c.menu.meals[0].items[0] = "unreadable";
			vi.mocked(f.assessment.assess).mockResolvedValue(result);
			await expectRejection("invalid_menu_coverage");
		},
	);
	it("accepts weekly menu with omitted dish-level cell evidence", async () => {
		const result = menu();
		vi.mocked(f.assessment.assess).mockResolvedValue({
			...result,
			evidence: result.evidence.filter((e) => !e.fieldPath.startsWith("/menu/meals/")),
		});
		expect(await f.execute()).toEqual({ outcome: "accepted" });
	});
	it("rejects missing root date range support for weekly range", async () => {
		const result = menu();
		vi.mocked(f.assessment.assess).mockResolvedValue({
			...result,
			evidence: result.evidence.filter((e) => e.fieldPath !== "/dateRange/start"),
		});
		await expectRejection("invalid_menu_coverage");
	});
	it.each([
		["cheftalk_regular", "Cheftalk"],
		["cheftalk_jain", "Cheftalk Jain"],
	] as const)("accepts source vendor %s with %s", async (vendor, quote) => {
		vi.mocked(f.assessment.assess).mockResolvedValue(menu(vendor, quote));
		expect(await f.execute()).toEqual({ outcome: "accepted" });
		expect(f.persisted()!.menuExtraction!.menu.vendor).toBe(vendor);
	});
	it("rejects narrowed Cheftalk evidence that would erase explicit Jain", async () => {
		const result = menu("cheftalk_regular", "Cheftalk");
		const evidence = result.evidence.map((e) =>
			e.fieldPath === "/menu/vendor" ? { ...e, clause: "Cheftalk Jain weekly menu" } : e,
		);
		vi.mocked(f.assessment.assess).mockResolvedValue({ ...result, evidence });
		await expectRejection();
	});
	it("rejects a Jain source caption even when the selected vendor evidence omits the qualifier", async () => {
		vi.mocked(f.repository.claimNext).mockResolvedValue({
			source: { ...source, textBody: "Cheftalk Jain weekly menu" },
			lease,
		});
		vi.mocked(f.assessment.assess).mockResolvedValue(menu("cheftalk_regular", "Cheftalk"));
		await expectRejection("ambiguous_content");
	});

	it("assesses the unchanged original timestamp and accepts relative dates independent of wall-clock and capture time", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2031-04-20T00:00:00Z"));
		useText(operational(), locationText);
		expect(await f.execute()).toEqual({ outcome: "accepted" });
		expect(f.assessment.assess).toHaveBeenCalledWith(
			expect.objectContaining({
				originalCreatedAt: source.originalCreatedAt,
				capturedAt: source.capturedAt,
			}),
			f.controller.signal,
		);
		expect((f.persisted()!.candidate as Operational).announcement.locations[0].mealDate).toBe(
			"2026-11-01",
		);
	});
	it("rejects the whole clear location plus fully evidenced ambiguous dish change", async () => {
		const result = operational(),
			c = result.candidate as Operational;
		const clause = "Today Cheftalk lunch replace Rice with Dal or Paneer";
		const body = `${locationText}. ${clause}`;
		Object.assign(c.announcement, {
			changes: [
				{
					mealDate: "2026-11-01",
					mealSlot: "lunch",
					targetVendor: "cheftalk_regular",
					changeType: "replacement",
					originalItem: "Rice",
					affectedItem: "Dal",
				},
			],
		});
		const evidence = [
			...result.evidence,
			...textEvidence(
				body,
				"/announcement/changes/0",
				[
					["mealDate", "Today"],
					["mealSlot", "lunch"],
					["targetVendor", "Cheftalk"],
					["changeType", "replace"],
					["originalItem", "Rice"],
					["affectedItem", "Dal"],
				],
				clause,
			).map((e) => ({
				...e,
				location: {
					kind: "text" as const,
					start: body.indexOf(e.rawValue, locationText.length),
					end: body.indexOf(e.rawValue, locationText.length) + e.rawValue.length,
				},
			})),
		];
		useText({ ...result, evidence }, body);
		await expectRejection("ambiguous_content");
		expect(f.repository.reject).toHaveBeenCalledWith(
			lease,
			expect.objectContaining({
				diagnostics: expect.objectContaining({
					candidate: c,
					evidence,
					rawExtraction: result.rawExtraction,
				}),
			}),
		);
	});
	it("rejects conflicting complete location allocations atomically", async () => {
		const result = operational(),
			c = result.candidate as Operational;
		const second = "Today lunch for all batches in college";
		const body = `${locationText}. ${second}`;
		Object.assign(c.announcement, {
			locations: [
				...c.announcement.locations,
				{
					mealDate: "2026-11-01",
					mealSlot: "lunch",
					hostelBatches: [],
					collegeBatches: ["ALL_BATCHES"],
				},
			],
		});
		const extra = textEvidence(
			body,
			"/announcement/locations/1",
			[
				["mealDate", "Today"],
				["mealSlot", "lunch"],
				["collegeBatches/0", "all batches"],
			],
			second,
		).map((e) => ({
			...e,
			location: {
				kind: "text" as const,
				start: body.indexOf(e.rawValue, locationText.length),
				end: body.indexOf(e.rawValue, locationText.length) + e.rawValue.length,
			},
		}));
		useText({ ...result, evidence: [...result.evidence, ...extra] }, body);
		await expectRejection("ambiguous_content");
	});
	it("rejects operational text with no stated date rather than inheriting source time", async () => {
		const result = operational();
		const body = "lunch for all batches in hostel";
		useText(
			{
				...result,
				evidence: textEvidence(body, "/announcement/locations/0", [
					["mealSlot", "lunch"],
					["hostelBatches/0", "all batches"],
				]),
			},
			body,
		);
		await expectRejection("missing_date");
	});
	it("rejects contradictory original relative and explicit event dates", async () => {
		const result = operational();
		const body = "Today (2/11/26) lunch for all batches in hostel";
		useText(
			{
				...result,
				evidence: textEvidence(body, "/announcement/locations/0", [
					["mealDate", "2/11/26"],
					["mealSlot", "lunch"],
					["hostelBatches/0", "all batches"],
				]),
			},
			body,
		);
		await expectRejection();
	});
	it("rejects media captions presented as standalone operational candidates", async () => {
		vi.mocked(f.assessment.assess).mockResolvedValue(operational());
		await expectRejection("unsupported_type");
	});
	it("persists an unsupported assessment once with every available typed diagnostic", async () => {
		const result: FoodAssessmentResult = {
			kind: "rejected",
			reason: "unsupported_type",
			detail: "Not a supported complete menu",
			rawExtraction: "{unparsed raw",
			rawVerification: "raw abstention",
			model: "test-model",
			promptVersion: "test-prompt",
			recognizedType: "weekly_menu",
		};
		vi.mocked(f.assessment.assess).mockResolvedValue(result);
		await expectRejection("unsupported_type");
		expect(f.repository.reject).toHaveBeenCalledWith(lease, {
			outcome: "rejected",
			reason: result.reason,
			detail: result.detail,
			diagnostics: {
				rawExtraction: result.rawExtraction,
				rawVerification: result.rawVerification,
				model: result.model,
				promptVersion: result.promptVersion,
				recognizedType: result.recognizedType,
			},
		});
	});
	it("rejects an unknown candidate type without constructing a partial commit", async () => {
		vi.mocked(f.assessment.assess).mockResolvedValue({
			...menu(),
			candidate: { kind: "service_cancellation" } as unknown as FoodCandidate,
		});
		await expectRejection("unsupported_type");
	});
	it.each(["cheftalk_regular", "cheftalk_jain", "tcb"] as const)(
		"rejects all vendors together when %s has no target prerequisite",
		async (missing) => {
			useText(swapAssessment(), swapText);
			vi.mocked(f.staging.getMealsByDateAndSlot).mockImplementation(async (date, slot, vendor) =>
				date === "2026-11-01" && vendor === missing
					? []
					: [{ mealDate: date, mealSlot: slot, vendor: vendor!, items: ["Rice"] }],
			);
			await expectRejection("missing_prerequisite");
		},
	);
	it("commits all three vendor swap snapshots with both endpoints and original source evidence", async () => {
		useText(swapAssessment(), swapText);
		expect(await f.execute()).toEqual({ outcome: "accepted" });
		expect(f.persisted()!.resolvedSwaps).toEqual(
			["cheftalk_regular", "cheftalk_jain", "tcb"].map((vendor) => ({
				sourceMealDate: "2026-11-02",
				sourceMealSlot: "lunch",
				targetMealDate: "2026-11-01",
				targetMealSlot: "dinner",
				vendor,
				newItems: ["Source Rice"],
				previousItems: ["Target Roti"],
			})),
		);
		expect(f.staging.getMealsByDateAndSlot).toHaveBeenCalledTimes(6);
	});
	it("forwards typed infrastructure failure and diagnostics intact to the fenced failure path", async () => {
		const failure: FoodFailure = {
			code: "assessment_failure",
			detail: "transport failed",
			retriable: true,
			retryAfterMs: 8000,
			diagnostics: {
				rawExtraction: "raw first pass",
				rawVerification: "raw second pass",
				model: "test-model",
				promptVersion: "v1",
				recognizedType: "weekly_menu",
			},
		};
		vi.mocked(f.assessment.assess).mockRejectedValue({ failure });
		const retry = {
			outcome: "retry_scheduled" as const,
			nextAttemptAt: new Date("2026-11-03T00:00:08Z"),
		};
		vi.mocked(f.repository.fail).mockResolvedValue(retry);
		expect(await f.execute()).toEqual(retry);
		expect(f.repository.fail).toHaveBeenCalledWith(lease, failure);
		expect(f.repository.reject).not.toHaveBeenCalled();
		expect(f.repository.accept).not.toHaveBeenCalled();
	});
	it.each(["assess", "resolve_swaps", "accept", "reject"])(
		"logs unexpected %s errors with source and phase and uses fenced fail",
		async (phase) => {
			const error = new Error(`${phase} persistence unavailable`);
			if (phase === "assess") vi.mocked(f.assessment.assess).mockRejectedValue(error);
			if (phase === "resolve_swaps") {
				useText(swapAssessment(), swapText);
				vi.mocked(f.staging.getMealsByDateAndSlot).mockRejectedValue(error);
			}
			if (phase === "accept") vi.mocked(f.repository.accept).mockRejectedValue(error);
			if (phase === "reject") {
				vi.mocked(f.assessment.assess).mockResolvedValue({
					kind: "rejected",
					reason: "unsupported_type",
					detail: "unsupported",
					rawExtraction: "raw",
					model: "m",
					promptVersion: "v",
				});
				vi.mocked(f.repository.reject).mockRejectedValue(error);
			}
			expect(await f.execute()).toMatchObject({ outcome: "failed", reason: "unexpected_failure" });
			expect(f.repository.fail).toHaveBeenCalledWith(lease, {
				code: "unexpected_failure",
				detail: error.message,
				retriable: false,
			});
			expect(f.logger.error).toHaveBeenCalledWith(expect.any(String), error, {
				messageId: source.messageId,
				phase,
			});
		},
	);
	it.each([
		{ failure: { code: "bad", detail: "not a boolean", retriable: "true" } },
		{ status: 429, message: "SDK-shaped failure" },
	])("does not infer retries from malformed or undeclared error properties: %j", async (error) => {
		vi.mocked(f.assessment.assess).mockRejectedValue(error);
		await f.execute();
		expect(f.repository.fail).toHaveBeenCalledWith(
			lease,
			expect.objectContaining({ code: "unexpected_failure", retriable: false }),
		);
	});
	it("logs and propagates failure-save exceptions without a second attempt or semantic relabel", async () => {
		const failure = { code: "assessment_failure", detail: "provider failed", retriable: true };
		const error = new Error("failure persistence unavailable");
		vi.mocked(f.assessment.assess).mockRejectedValue({ failure });
		vi.mocked(f.repository.fail).mockRejectedValue(error);
		await expect(f.execute()).rejects.toBe(error);
		expect(f.repository.fail).toHaveBeenCalledTimes(1);
		expect(f.repository.reject).not.toHaveBeenCalled();
		expect(f.logger.error).toHaveBeenCalledWith(expect.any(String), error, {
			messageId: source.messageId,
			phase: "fail",
			failedPhase: "assess",
		});
	});
	it("propagates claim errors without inventing a lease", async () => {
		const error = new Error("claim unavailable");
		vi.mocked(f.repository.claimNext).mockRejectedValue(error);
		await expect(f.execute()).rejects.toBe(error);
		expect(f.repository.fail).not.toHaveBeenCalled();
	});
	it("uses the repository fence even when a late model result ignores cancellation", async () => {
		vi.mocked(f.assessment.assess).mockImplementation(async () => {
			f.controller.abort();
			return menu();
		});
		vi.mocked(f.repository.fail).mockResolvedValue({ outcome: "lease_lost" });
		expect(await f.execute()).toEqual({ outcome: "lease_lost" });
		expect(f.repository.accept).not.toHaveBeenCalled();
		expect(f.repository.fail).toHaveBeenCalledWith(
			lease,
			expect.objectContaining({ code: "cancelled", retriable: false }),
		);
	});
	it("checks cancellation after prerequisite reads before atomic acceptance", async () => {
		useText(swapAssessment(), swapText);
		vi.mocked(f.staging.getMealsByDateAndSlot).mockImplementation(async (date, slot, vendor) => {
			f.controller.abort();
			return [{ mealDate: date, mealSlot: slot, vendor: vendor!, items: ["Rice"] }];
		});
		vi.mocked(f.repository.fail).mockResolvedValue({ outcome: "lease_lost" });
		expect(await f.execute()).toEqual({ outcome: "lease_lost" });
		expect(f.repository.accept).not.toHaveBeenCalled();
		expect(f.repository.fail).toHaveBeenCalledWith(
			lease,
			expect.objectContaining({ code: "cancelled" }),
		);
	});
	it("honors finalizer prerequisite rejection without retrying the model or saving a second decision", async () => {
		const decision = {
			outcome: "rejected" as const,
			reason: "changed_prerequisite",
			detail: "Source changed under the atomic lock",
		};
		vi.mocked(f.repository.accept).mockResolvedValue(decision);
		expect(await f.execute()).toEqual(decision);
		expect(f.assessment.assess).toHaveBeenCalledTimes(1);
		expect(f.repository.reject).not.toHaveBeenCalled();
		expect(f.repository.fail).not.toHaveBeenCalled();
	});
	it("uses a fenced failure for cancellation before assessment", async () => {
		f.controller.abort();
		vi.mocked(f.repository.fail).mockResolvedValue({ outcome: "lease_lost" });
		expect(await f.execute()).toEqual({ outcome: "lease_lost" });
		expect(f.assessment.assess).not.toHaveBeenCalled();
		expect(f.repository.fail).toHaveBeenCalledWith(
			lease,
			expect.objectContaining({ code: "cancelled", retriable: false }),
		);
	});

	it("does not mask an unexpected persistence exception when cancellation also occurs", async () => {
		const error = new Error("atomic persistence failure");
		vi.mocked(f.repository.accept).mockImplementation(async () => {
			f.controller.abort();
			throw error;
		});
		expect(await f.execute()).toMatchObject({ outcome: "failed", reason: "unexpected_failure" });
		expect(f.logger.error).toHaveBeenCalledWith(expect.any(String), error, {
			messageId: source.messageId,
			phase: "accept",
		});
	});

	it("does not claim accepted locally when the atomic finalizer loses the lease", async () => {
		vi.mocked(f.repository.accept).mockResolvedValue({ outcome: "lease_lost" });
		expect(await f.execute()).toEqual({ outcome: "lease_lost" });
		expect(f.repository.fail).not.toHaveBeenCalled();
	});
});
