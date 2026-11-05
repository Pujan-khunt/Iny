import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StagedMealSwap } from "../../../src/core/entities/MessAnnouncement";
import type {
	StagedMealLookupRecord,
	MessStagingRepositoryPort,
} from "../../../src/core/ports/MessStagingRepositoryPort";
import { MealSwapResolver } from "../../../src/core/services/MealSwapResolver";

const swap: StagedMealSwap = {
	sourceMealDate: "2026-11-02",
	sourceMealSlot: "lunch",
	targetMealDate: "2026-11-01",
	targetMealSlot: "dinner",
	targetVendor: "cheftalk_regular",
};
const lookup = vi.fn<MessStagingRepositoryPort["getMealsByDateAndSlot"]>();
const repository: MessStagingRepositoryPort = {
	getMealsByDateAndSlot: lookup,
	getIngestionAudit: vi.fn().mockResolvedValue(null),
	stageMessage: vi.fn(),
	listStagedMessages: vi.fn(),
	getMessageById: vi.fn(),
	atomicCommit: vi.fn(),
	atomicCommitComposite: vi.fn(),
	markIgnored: vi.fn(),
	atomicUndo: vi.fn(),
	atomicReset: vi.fn(),
};
const row = (date: string, slot: string, vendor: string): StagedMealLookupRecord => ({
	mealDate: date,
	mealSlot: slot,
	vendor,
	items: date === "2026-11-02" ? ["Rice", "Dal"] : ["Roti", "Curry"],
});
const resolver = new MealSwapResolver(repository);

beforeEach(() => {
	vi.clearAllMocks();
	lookup.mockImplementation(async (date, slot, vendor) => [row(date, slot, vendor as string)]);
});
afterEach(() => {
	for (const method of [
		repository.stageMessage,
		repository.atomicCommit,
		repository.atomicCommitComposite,
		repository.markIgnored,
		repository.atomicUndo,
		repository.atomicReset,
	])
		expect(method).not.toHaveBeenCalled();
});

describe("MealSwapResolver", () => {
	it("rejects the whole all-vendor swap when one target vendor is missing", async () => {
		lookup.mockImplementation(async (date, slot, vendor) =>
			date === "2026-11-01" && vendor === "cheftalk_jain"
				? []
				: [row(date, slot, vendor as string)],
		);
		expect(await resolver.resolve([{ ...swap, targetVendor: null }])).toEqual({
			ok: false,
			reason: "missing_prerequisite",
			detail: expect.any(String),
		});
	});

	it("resolves a vendor-specific swap with both endpoint snapshots", async () => {
		expect(await resolver.resolve([swap])).toEqual({
			ok: true,
			value: [
				{
					targetMealDate: "2026-11-01",
					targetMealSlot: "dinner",
					vendor: "cheftalk_regular",
					sourceMealDate: "2026-11-02",
					sourceMealSlot: "lunch",
					newItems: ["Rice", "Dal"],
					previousItems: ["Roti", "Curry"],
				},
			],
		});
		expect(lookup).toHaveBeenCalledWith("2026-11-02", "lunch", "cheftalk_regular");
		expect(lookup).toHaveBeenCalledWith("2026-11-01", "dinner", "cheftalk_regular");
	});

	it("expands explicit null into all three supported vendor snapshots", async () => {
		const result = await resolver.resolve([{ ...swap, targetVendor: null }]);
		expect(result).toEqual({
			ok: true,
			value: [
				expect.objectContaining({
					vendor: "cheftalk_regular",
					newItems: ["Rice", "Dal"],
					previousItems: ["Roti", "Curry"],
				}),
				expect.objectContaining({
					vendor: "cheftalk_jain",
					newItems: ["Rice", "Dal"],
					previousItems: ["Roti", "Curry"],
				}),
				expect.objectContaining({
					vendor: "tcb",
					newItems: ["Rice", "Dal"],
					previousItems: ["Roti", "Curry"],
				}),
			],
		});
		expect(lookup).toHaveBeenCalledTimes(6);
	});

	it.each(["source", "target"])("rejects a missing %s", async (endpoint) => {
		lookup.mockImplementation(async (date, slot, vendor) =>
			date === (endpoint === "source" ? "2026-11-02" : "2026-11-01")
				? []
				: [row(date, slot, vendor as string)],
		);
		expect(await resolver.resolve([swap])).toEqual({
			ok: false,
			reason: "missing_prerequisite",
			detail: expect.any(String),
		});
	});

	it.each(["source", "target"])(
		"rejects duplicate %s rows instead of selecting one",
		async (endpoint) => {
			lookup.mockImplementation(async (date, slot, vendor) => {
				const meal = row(date, slot, vendor as string);
				return date === (endpoint === "source" ? "2026-11-02" : "2026-11-01")
					? [meal, meal]
					: [meal];
			});
			expect(await resolver.resolve([swap])).toMatchObject({
				ok: false,
				reason: "missing_prerequisite",
			});
		},
	);

	it.each([
		["source", []],
		["target", []],
		["source", [" "]],
		["target", ["Rice", ""]],
	] as const)("rejects %s dishes %j", async (endpoint, items) => {
		lookup.mockImplementation(async (date, slot, vendor) => [
			{
				...row(date, slot, vendor as string),
				...(date === (endpoint === "source" ? "2026-11-02" : "2026-11-01")
					? { items: [...items] }
					: {}),
			},
		]);
		expect(await resolver.resolve([swap])).toMatchObject({
			ok: false,
			reason: "missing_prerequisite",
		});
	});

	it.each(["source", "target"])("rejects mismatching %s row identity", async (endpoint) => {
		for (const mismatch of [
			{ mealDate: "2026-11-03" },
			{ mealSlot: "breakfast" },
			{ vendor: "tcb" },
		]) {
			lookup.mockImplementation(async (date, slot, vendor) => [
				{
					...row(date, slot, vendor as string),
					...(date === (endpoint === "source" ? "2026-11-02" : "2026-11-01") ? mismatch : {}),
				},
			]);
			expect(await resolver.resolve([swap])).toMatchObject({
				ok: false,
				reason: "missing_prerequisite",
			});
		}
	});

	it.each([undefined, "unknown"])("rejects unstated or unsupported scope %s", async (scope) => {
		expect(
			await resolver.resolve([{ ...swap, targetVendor: scope } as StagedMealSwap]),
		).toMatchObject({ ok: false, reason: "ambiguous_content" });
		expect(lookup).not.toHaveBeenCalled();
	});

	it("rejects omitted vendor scope", async () => {
		const unscoped = { ...swap };
		delete unscoped.targetVendor;
		expect(await resolver.resolve([unscoped])).toMatchObject({
			ok: false,
			reason: "ambiguous_content",
		});
	});

	it.each(["source", "target"])(
		"propagates infrastructure errors for %s lookup",
		async (endpoint) => {
			const error = new Error("repository unavailable");
			lookup.mockImplementation(async (date, slot, vendor) => {
				if (date === (endpoint === "source" ? "2026-11-02" : "2026-11-01")) throw error;
				return [row(date, slot, vendor as string)];
			});
			await expect(resolver.resolve([swap])).rejects.toBe(error);
		},
	);

	it("returns independent snapshots isolated from subsequent row and output mutations", async () => {
		const source = row("2026-11-02", "lunch", "cheftalk_regular");
		const target = row("2026-11-01", "dinner", "cheftalk_regular");
		lookup.mockImplementation(async (date) => [date === "2026-11-02" ? source : target]);
		const result = await resolver.resolve([swap]);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.detail);
		source.items.push("Changed source");
		target.items.push("Changed target");
		expect(result.value[0]?.newItems).toEqual(["Rice", "Dal"]);
		expect(result.value[0]?.previousItems).toEqual(["Roti", "Curry"]);
		result.value[0]?.newItems.push("New snapshot only");
		result.value[0]?.previousItems.push("Old snapshot only");
		expect(source.items).toEqual(["Rice", "Dal", "Changed source"]);
		expect(target.items).toEqual(["Roti", "Curry", "Changed target"]);
	});

	it.each(["same_vendor", "all_then_specific", "specific_then_all"])(
		"rejects duplicate expanded target keys: %s",
		async (mode) => {
			const all = { ...swap, targetVendor: null };
			const otherSource = { ...swap, sourceMealDate: "2026-11-03" };
			const swaps =
				mode === "same_vendor"
					? [swap, otherSource]
					: mode === "all_then_specific"
						? [all, swap]
						: [swap, all];
			expect(await resolver.resolve(swaps)).toMatchObject({
				ok: false,
				reason: "ambiguous_content",
			});
		},
	);

	it("accepts distinct target vendors, dates and slots across input swaps", async () => {
		const result = await resolver.resolve([
			swap,
			{ ...swap, targetVendor: "tcb" },
			{ ...swap, targetMealDate: "2026-11-03" },
			{ ...swap, targetMealSlot: "breakfast" },
		]);
		expect(result.ok && result.value.length).toBe(4);
	});

	it("returns no successful partial result when a later swap is missing a prerequisite", async () => {
		lookup.mockImplementation(async (date, slot, vendor) =>
			vendor === "tcb" ? [] : [row(date, slot, vendor as string)],
		);
		expect(await resolver.resolve([swap, { ...swap, targetVendor: "tcb" }])).toEqual({
			ok: false,
			reason: "missing_prerequisite",
			detail: expect.any(String),
		});
	});

	it("accepts an empty swap set without querying the repository", async () => {
		expect(await resolver.resolve([])).toEqual({ ok: true, value: [] });
		expect(lookup).not.toHaveBeenCalled();
	});
});
