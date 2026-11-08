import { describe, expect, it } from "vitest";
import type {
	FoodAnnouncementSource,
	FoodCandidate,
	SourceEvidence,
} from "../../../src/core/entities/FoodAnnouncement";
import type { OperationalAnnouncement } from "../../../src/core/entities/MessAnnouncement";
import { AnnouncementEvidenceValidator } from "../../../src/core/services/AnnouncementEvidenceValidator";
import { OperationalAnnouncementValidator } from "../../../src/core/services/OperationalAnnouncementValidator";

type Candidate = Extract<FoodCandidate, { kind: "operational_announcement" }>;
const text = "Tommorow (1/11/26), lunch will be arranged in the hostel for all batches";
const source: FoodAnnouncementSource = {
	messageId: "m",
	groupJid: "g",
	senderAddress: "s",
	senderAddressType: "pn",
	deliveryMode: "notify",
	originalCreatedAt: new Date("2026-10-31T10:00:00Z"),
	capturedAt: new Date(),
	messageType: "text",
	textBody: text,
	mediaMimeType: null,
	mediaBytes: null,
};
function fixture(): Candidate {
	return {
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
}
function records(body = text): SourceEvidence[] {
	return [
		["mealDate", "1/11/26"],
		["mealSlot", "lunch"],
		["hostelBatches/0", "all batches"],
	].map(([field, rawValue]) => ({
		fieldPath: `/announcement/locations/0/${field}`,
		rawValue,
		clause: body,
		location: {
			kind: "text",
			start: body.indexOf(rawValue),
			end: body.indexOf(rawValue) + rawValue.length,
		},
	}));
}
function check(
	kind: keyof OperationalAnnouncement,
	event: object,
	body: string,
	values: [string, string][],
) {
	const candidate = fixture();
	Object.assign(candidate.announcement, { locations: [], [kind]: [event] });
	const evidence: SourceEvidence[] = values.map(([field, rawValue]) => ({
		fieldPath: `/announcement/${kind}/0/${field}`,
		rawValue,
		clause: body,
		location: {
			kind: "text",
			start: body.indexOf(rawValue),
			end: body.indexOf(rawValue) + rawValue.length,
		},
	}));
	return OperationalAnnouncementValidator.validate(
		candidate,
		{ ...source, textBody: body },
		evidence,
	);
}
const base = { mealDate: "2026-11-01", mealSlot: "lunch" as const };
const dateSlot: [string, string][] = [
	["mealDate", "1/11/26"],
	["mealSlot", "lunch"],
];
const swap = {
	targetMealDate: "2026-10-31",
	targetMealSlot: "dinner",
	sourceMealDate: "2026-11-01",
	sourceMealSlot: "lunch",
	targetVendor: null,
};
const swapFields: [string, string][] = [
	["targetMealDate", "Today"],
	["targetMealSlot", "dinner"],
	["sourceMealDate", "tomorrow"],
	["sourceMealSlot", "lunch"],
];
describe("OperationalAnnouncementValidator", () => {
	it("accepts a source-dated all-batches location", () => {
		expect(OperationalAnnouncementValidator.validate(fixture(), source, records()).ok).toBe(true);
	});
	it("preserves explicit batch groups alongside cohort-wide references", () => {
		const body = "1/11/26 lunch: 2029 B in hostel, 2030 in college";
		const candidate = fixture();
		Object.assign(candidate.announcement.locations[0], {
			...base,
			hostelBatches: ["2029 B"],
			collegeBatches: ["2030"],
		});
		const evidence = [
			["mealDate", "1/11/26"],
			["mealSlot", "lunch"],
			["hostelBatches/0", "2029 B"],
			["collegeBatches/0", "2030"],
		].map(([field, rawValue]) => ({
			fieldPath: `/announcement/locations/0/${field}`,
			rawValue,
			clause: body,
			location: {
				kind: "text" as const,
				start: body.indexOf(rawValue),
				end: body.indexOf(rawValue) + rawValue.length,
			},
		}));
		expect(
			OperationalAnnouncementValidator.validate(candidate, { ...source, textBody: body }, evidence)
				.ok,
		).toBe(true);
	});
	it("accepts a shared trailing venue for a listed batch exception", () => {
		const body =
			"Tomorrow (4/11/26), lunch will be arranged in the hostel for all batches except 2028 A, 2029 B, 2030 their lunch will be arranged in college.";
		const candidate = fixture();
		Object.assign(candidate.announcement.locations[0], {
			mealDate: "2026-11-04",
			mealSlot: "lunch",
			hostelBatches: ["ALL_OTHER_BATCHES"],
			collegeBatches: ["2028 A", "2029 B", "2030"],
		});
		const evidence = [
			["mealDate", "Tomorrow (4/11/26)"],
			["mealSlot", "lunch"],
			["hostelBatches/0", "all batches except 2028 A, 2029 B, 2030"],
			["collegeBatches/0", "2028 A"],
			["collegeBatches/1", "2029 B"],
			["collegeBatches/2", "2030"],
		].map(([field, rawValue]) => ({
			fieldPath: `/announcement/locations/0/${field}`,
			rawValue,
			clause: body,
			location: {
				kind: "text" as const,
				start: body.indexOf(rawValue),
				end: body.indexOf(rawValue) + rawValue.length,
			},
		}));
		expect(
			OperationalAnnouncementValidator.validate(
				candidate,
				{ ...source, originalCreatedAt: new Date("2026-11-03T16:28:10Z"), textBody: body },
				evidence,
			).ok,
		).toBe(true);
	});
	it("rejects a group outside the configured cohort universe", () => {
		const body = "1/11/26 lunch: 2030 F in college";
		const candidate = fixture();
		Object.assign(candidate.announcement.locations[0], {
			...base,
			hostelBatches: [],
			collegeBatches: ["2030 F"],
		});
		const evidence = [
			["mealDate", "1/11/26"],
			["mealSlot", "lunch"],
			["collegeBatches/0", "2030 F"],
		].map(([field, rawValue]) => ({
			fieldPath: `/announcement/locations/0/${field}`,
			rawValue,
			clause: body,
			location: {
				kind: "text" as const,
				start: body.indexOf(rawValue),
				end: body.indexOf(rawValue) + rawValue.length,
			},
		}));
		expect(
			OperationalAnnouncementValidator.validate(candidate, { ...source, textBody: body }, evidence)
				.ok,
		).toBe(false);
	});
	it("rejects a bare year evidence span that hides an explicit section", () => {
		const body = "1/11/26 lunch: 2029 B in college";
		const candidate = fixture();
		Object.assign(candidate.announcement.locations[0], {
			hostelBatches: [],
			collegeBatches: ["2029"],
		});
		const evidence = [
			["mealDate", "1/11/26"],
			["mealSlot", "lunch"],
			["collegeBatches/0", "2029"],
		].map(([field, rawValue]) => ({
			fieldPath: `/announcement/locations/0/${field}`,
			rawValue,
			clause: body,
			location: {
				kind: "text" as const,
				start: body.indexOf(rawValue),
				end: body.indexOf(rawValue) + rawValue.length,
			},
		}));
		expect(
			OperationalAnnouncementValidator.validate(candidate, { ...source, textBody: body }, evidence)
				.ok,
		).toBe(false);
	});
	it.each([
		"empty",
		"missing slot",
		"missing date",
		"contradictory batches",
		"unsupported batch",
		"relative conflict",
		"no date",
		"media",
		"missing timestamp",
	])("rejects %s", (problem) => {
		const c = fixture(),
			s = { ...source };
		if (problem === "empty") Object.assign(c.announcement, { locations: [] });
		if (problem === "missing slot")
			Object.assign(c.announcement.locations[0], { mealSlot: undefined });
		if (problem === "missing date")
			Object.assign(c.announcement.locations[0], { mealDate: undefined });
		if (problem === "contradictory batches")
			Object.assign(c.announcement.locations[0], { collegeBatches: ["2028"] });
		if (problem === "unsupported batch")
			Object.assign(c.announcement.locations[0], { hostelBatches: ["UG1"] });
		if (problem === "relative conflict") s.originalCreatedAt = new Date("2026-11-01T10:00:00Z");
		if (problem === "no date") s.textBody = "lunch in hostel for all batches";
		if (problem === "media") s.messageType = "image";
		if (problem === "missing timestamp") s.originalCreatedAt = null;
		expect(OperationalAnnouncementValidator.validate(c, s, records(s.textBody ?? "")).ok).toBe(
			false,
		);
	});
	it.each([
		["until 10:00 PM", true],
		["from 13:00", true],
		["10:00", false],
		["10:00 PM", false],
		["until 10:00", false],
		["from 13:00 PM", false],
		["from 10:00 PM until 9:00 PM", false],
		["between 10:00 PM", false],
	] as const)("checks timing %s", (extendedTimings, want) => {
		const event = { ...base, targetVendor: null, extendedTimings };
		expect(
			check("timings", event, `1/11/26 lunch ${extendedTimings}`, [
				...dateSlot,
				["extendedTimings", extendedTimings],
			]).ok,
		).toBe(want);
	});
	it("requires timing scope to retain a named vendor", () => {
		expect(
			check(
				"timings",
				{ ...base, targetVendor: null, extendedTimings: "until 10:00 PM" },
				"1/11/26 TCB lunch until 10:00 PM",
				[...dateSlot, ["extendedTimings", "until 10:00 PM"]],
			).ok,
		).toBe(false);
	});
	it.each([
		["replacement", "Poha", "Paneer", true],
		["replacement", null, "Paneer", false],
		["addition", null, "Paneer", true],
		["cancellation", null, "Paneer", true],
		["cancellation", null, "lunch service", false],
	] as const)("checks %s from %s to %s", (changeType, originalItem, affectedItem, want) => {
		const event = { ...base, targetVendor: "tcb", changeType, originalItem, affectedItem };
		const values: [string, string][] = [
			...dateSlot,
			["targetVendor", "TCB"],
			["changeType", changeType === "replacement" ? "replace" : changeType],
			["affectedItem", affectedItem],
		];
		if (originalItem) values.push(["originalItem", originalItem]);
		expect(
			check(
				"changes",
				event,
				changeType === "replacement"
					? `1/11/26 lunch TCB replace ${originalItem ?? ""} with ${affectedItem}`
					: `1/11/26 lunch TCB ${changeType} ${affectedItem}`,
				values,
			).ok,
		).toBe(want);
	});
	it("accepts source and target swap dates that differ", () => {
		expect(
			check("swaps", swap, "Today's dinner will serve tomorrow's lunch menu.", swapFields).ok,
		).toBe(true);
	});
	it.each([
		"Today (1/11/26)'s dinner will serve tomorrow's lunch menu.",
		"Today's dinner will serve tomorrow (2/11/26)'s lunch menu.",
	])("rejects conflicting endpoint date: %s", (body) => {
		expect(check("swaps", swap, body, swapFields).ok).toBe(false);
	});
	it("rejects a swap lacking source endpoint evidence", () => {
		expect(
			check(
				"swaps",
				swap,
				"Today's dinner will serve tomorrow's lunch menu.",
				swapFields.slice(0, 2),
			).ok,
		).toBe(false);
	});
	it("rejects overlapping allocations across events", () => {
		const c = fixture();
		Object.assign(c.announcement, {
			locations: [
				c.announcement.locations[0],
				{ ...base, hostelBatches: [], collegeBatches: ["ALL_BATCHES"] },
			],
		});
		const body = `${text}; 1/11/26 lunch in college for all batches`;
		const evidence = records(body);
		evidence.push(
			...records(body).map((e) => ({
				...e,
				fieldPath: e.fieldPath
					.replace("locations/0", "locations/1")
					.replace("hostelBatches", "collegeBatches"),
			})),
		);
		expect(
			OperationalAnnouncementValidator.validate(c, { ...source, textBody: body }, evidence).ok,
		).toBe(false);
	});
	it("rejects clause dates conflicting with otherwise matching raw date evidence", () => {
		const body = text.replace("Tommorow", "Yesterday");
		expect(
			OperationalAnnouncementValidator.validate(
				fixture(),
				{ ...source, textBody: body },
				records(body),
			),
		).toMatchObject({ ok: false, reason: "conflicting_date" });
	});
	it.each(["1/11/26 lunch from 13:00 PM", "1/11/26 lunch from 14:00 until 13:00"])(
		"rejects a timing summary omitting source qualifiers: %s",
		(body) => {
			const extendedTimings = body.includes("PM") ? "from 13:00" : "until 13:00";
			expect(
				check("timings", { ...base, targetVendor: null, extendedTimings }, body, [
					...dateSlot,
					["extendedTimings", extendedTimings],
				]).ok,
			).toBe(false);
		},
	);
	it("rejects swap slots bound to the opposite endpoints", () => {
		expect(
			check("swaps", swap, "Today's lunch will serve tomorrow's dinner menu.", swapFields).ok,
		).toBe(false);
	});
	it("binds replacement source on the left and target on the right", () => {
		const fields: [string, string][] = swapFields.map(([key, raw]) => [
			key,
			raw === "tomorrow" ? "Tomorrow" : raw,
		]);
		expect(check("swaps", swap, "Tomorrow's lunch replaces Today's dinner menu.", fields).ok).toBe(
			true,
		);
		expect(
			check("swaps", swap, "Today's dinner replaces tomorrow's lunch menu.", swapFields).ok,
		).toBe(false);
	});
	it("rejects a dish event with missing vendor despite complete dish/date support", () => {
		const values: [string, string][] = [
			...dateSlot,
			["changeType", "addition"],
			["affectedItem", "Paneer"],
		];
		expect(
			check(
				"changes",
				{
					...base,
					targetVendor: null,
					changeType: "addition",
					affectedItem: "Paneer",
					originalItem: null,
				},
				"1/11/26 lunch TCB addition Paneer",
				values,
			).ok,
		).toBe(false);
	});
	it("rejects a whole candidate combining a clear location and incomplete replacement", () => {
		const candidate = fixture();
		Object.assign(candidate.announcement, {
			changes: [
				{
					...base,
					targetVendor: "tcb",
					changeType: "replacement",
					affectedItem: "Paneer",
					originalItem: null,
				},
			],
		});
		expect(OperationalAnnouncementValidator.validate(candidate, source, records()).ok).toBe(false);
	});
	it("accepts documented section batches and the explicit remaining-batches allocation", () => {
		expect(
			check(
				"locations",
				{ ...base, hostelBatches: ["2029 A"], collegeBatches: ["ALL_OTHER_BATCHES"] },
				"1/11/26 lunch: 2029 A in hostel, remaining batches in college",
				[...dateSlot, ["hostelBatches/0", "2029 A"], ["collegeBatches/0", "remaining batches"]],
			).ok,
		).toBe(true);
	});
	it("rejects exact batch tokens bound to the opposite source venue", () => {
		expect(
			check(
				"locations",
				{ ...base, hostelBatches: ["2029 A"], collegeBatches: ["ALL_OTHER_BATCHES"] },
				"1/11/26 lunch: 2029 A in college, remaining batches in hostel",
				[...dateSlot, ["hostelBatches/0", "2029 A"], ["collegeBatches/0", "remaining batches"]],
			).ok,
		).toBe(false);
	});
	it("rejects exact replacement tokens bound to opposite old and new roles", () => {
		expect(
			check(
				"changes",
				{
					...base,
					targetVendor: "tcb",
					changeType: "replacement",
					originalItem: "Paneer",
					affectedItem: "Poha",
				},
				"1/11/26 lunch TCB: replace Poha with Paneer",
				[
					...dateSlot,
					["targetVendor", "TCB"],
					["changeType", "replace"],
					["originalItem", "Paneer"],
					["affectedItem", "Poha"],
				],
			).ok,
		).toBe(false);
	});
	it.each(["from 1 PM or 2 PM", "from 1 PM and 2 PM", "until 1 PM or 2 PM"])(
		"rejects competing timing roles: %s",
		(extendedTimings) => {
			expect(
				check(
					"timings",
					{ ...base, targetVendor: null, extendedTimings },
					`1/11/26 lunch ${extendedTimings}`,
					[...dateSlot, ["extendedTimings", extendedTimings]],
				).ok,
			).toBe(false);
		},
	);
	it("rejects disjoint location entries sharing the same storage key", () => {
		const candidate = fixture();
		Object.assign(candidate.announcement, {
			locations: [
				{ ...base, hostelBatches: ["2028"], collegeBatches: [] },
				{ ...base, hostelBatches: [], collegeBatches: ["2029"] },
			],
		});
		const body = "1/11/26 lunch: 2028 in hostel; 2029 in college";
		const evidence: SourceEvidence[] = [
			["0/mealDate", "1/11/26"],
			["0/mealSlot", "lunch"],
			["0/hostelBatches/0", "2028"],
			["1/mealDate", "1/11/26"],
			["1/mealSlot", "lunch"],
			["1/collegeBatches/0", "2029"],
		].map(([field, rawValue]) => ({
			fieldPath: `/announcement/locations/${field}`,
			rawValue,
			clause: body,
			location: {
				kind: "text",
				start: body.indexOf(rawValue),
				end: body.indexOf(rawValue) + rawValue.length,
			},
		}));
		expect(
			OperationalAnnouncementValidator.validate(candidate, { ...source, textBody: body }, evidence)
				.ok,
		).toBe(false);
	});

	it("accepts correctly bound batches in the reviewed source wording", () => {
		expect(
			check(
				"locations",
				{ ...base, hostelBatches: ["ALL_OTHER_BATCHES"], collegeBatches: ["2029 A"] },
				"1/11/26 lunch: 2029 A in college, remaining batches in hostel",
				[...dateSlot, ["collegeBatches/0", "2029 A"], ["hostelBatches/0", "remaining batches"]],
			).ok,
		).toBe(true);
	});
	it("accepts correctly bound old and new replacement dishes", () => {
		expect(
			check(
				"changes",
				{
					...base,
					targetVendor: "tcb",
					changeType: "replacement",
					originalItem: "Poha",
					affectedItem: "Paneer",
				},
				"1/11/26 lunch TCB: replace Poha with Paneer",
				[
					...dateSlot,
					["targetVendor", "TCB"],
					["changeType", "replace"],
					["originalItem", "Poha"],
					["affectedItem", "Paneer"],
				],
			).ok,
		).toBe(true);
	});
	it("preserves a supported complete two-endpoint timing window", () => {
		const extendedTimings = "from 12:00 PM until 2:00 PM";
		expect(
			check(
				"timings",
				{ ...base, targetVendor: null, extendedTimings },
				`1/11/26 lunch ${extendedTimings}`,
				[...dateSlot, ["extendedTimings", extendedTimings]],
			).ok,
		).toBe(true);
	});
	it("rejects batch tokens without a recognizable venue assignment", () => {
		expect(
			check(
				"locations",
				{ ...base, hostelBatches: ["2029 A"], collegeBatches: ["ALL_OTHER_BATCHES"] },
				"1/11/26 lunch: hostel college 2029 A remaining batches",
				[...dateSlot, ["hostelBatches/0", "2029 A"], ["collegeBatches/0", "remaining batches"]],
			).ok,
		).toBe(false);
	});
	it("rejects replacement tokens without a recognizable old/new assignment", () => {
		expect(
			check(
				"changes",
				{
					...base,
					targetVendor: "tcb",
					changeType: "replacement",
					originalItem: "Poha",
					affectedItem: "Paneer",
				},
				"1/11/26 lunch TCB: replacement Poha Paneer",
				[
					...dateSlot,
					["targetVendor", "TCB"],
					["changeType", "replacement"],
					["originalItem", "Poha"],
					["affectedItem", "Paneer"],
				],
			).ok,
		).toBe(false);
	});
	it("preserves punctuation in source-backed replacement names", () => {
		expect(
			check(
				"changes",
				{
					...base,
					targetVendor: "tcb",
					changeType: "replacement",
					originalItem: "Poha (Jain)",
					affectedItem: "Paneer",
				},
				"1/11/26 lunch TCB: replace Poha (Jain) with Paneer",
				[
					...dateSlot,
					["targetVendor", "TCB"],
					["changeType", "replace"],
					["originalItem", "Poha (Jain)"],
					["affectedItem", "Paneer"],
				],
			).ok,
		).toBe(true);
	});
	it("rejects competing venues despite matching the first supported assignment", () => {
		expect(
			check(
				"locations",
				{ ...base, hostelBatches: ["ALL_BATCHES"], collegeBatches: [] },
				"1/11/26 lunch: all batches in hostel or college",
				[...dateSlot, ["hostelBatches/0", "all batches"]],
			).ok,
		).toBe(false);
	});
	it("rejects alternative replacement dishes despite matching the first candidate", () => {
		expect(
			check(
				"changes",
				{
					...base,
					targetVendor: "tcb",
					changeType: "replacement",
					originalItem: "Poha",
					affectedItem: "Paneer",
				},
				"1/11/26 lunch TCB: replace Poha with Paneer or Dal",
				[
					...dateSlot,
					["targetVendor", "TCB"],
					["changeType", "replace"],
					["originalItem", "Poha"],
					["affectedItem", "Paneer"],
				],
			).ok,
		).toBe(false);
	});
	it.each([
		["2026-11-02", "lunch", "2/11/26"],
		["2026-11-01", "dinner", "1/11/26"],
	] as const)(
		"preserves multiple locations for distinct key %s/%s",
		(mealDate, mealSlot, rawDate) => {
			const candidate = fixture();
			Object.assign(candidate.announcement, {
				locations: [
					{ ...base, hostelBatches: ["2028"], collegeBatches: [] },
					{ mealDate, mealSlot, hostelBatches: [], collegeBatches: ["2029"] },
				],
			});
			const clauses = ["1/11/26 lunch: 2028 in hostel", `${rawDate} ${mealSlot}: 2029 in college`];
			const body = clauses.join("; ");
			const evidence: SourceEvidence[] = clauses.flatMap((clause, i) => {
				const values = [
					["mealDate", i ? rawDate : "1/11/26"],
					["mealSlot", i ? mealSlot : "lunch"],
					[i ? "collegeBatches/0" : "hostelBatches/0", i ? "2029" : "2028"],
				];
				return values.map(([field, rawValue]) => {
					const start = body.indexOf(clause) + clause.indexOf(rawValue);
					return {
						fieldPath: `/announcement/locations/${i}/${field}`,
						rawValue,
						clause,
						location: { kind: "text", start, end: start + rawValue.length },
					};
				});
			});
			expect(
				OperationalAnnouncementValidator.validate(
					candidate,
					{ ...source, textBody: body },
					evidence,
				).ok,
			).toBe(true);
		},
	);
	it("rejects an out-of-range dish-role evidence path without throwing", () => {
		const candidate = fixture();
		Object.assign(candidate.announcement, {
			locations: [],
			changes: [
				{
					...base,
					targetVendor: "tcb",
					changeType: "replacement",
					originalItem: "Poha",
					affectedItem: "Paneer",
				},
			],
		});
		const body = "1/11/26 lunch TCB: replace Poha with Paneer";
		const start = body.indexOf("Poha");
		const evidence: SourceEvidence[] = [
			{
				fieldPath: "/announcement/changes/99/originalItem",
				rawValue: "Poha",
				clause: body,
				location: { kind: "text", start, end: start + 4 },
			},
		];
		expect(() =>
			OperationalAnnouncementValidator.validate(candidate, { ...source, textBody: body }, evidence),
		).not.toThrow();
		expect(
			OperationalAnnouncementValidator.validate(candidate, { ...source, textBody: body }, evidence)
				.ok,
		).toBe(false);
	});
	it.each([
		["Paneer (Jain)", "Paneer (Jain)", true],
		["Paneer (Jain)", "Paneer", false],
		["Paneer Masala", "Paneer", false],
		["PaneerMasala", "Paneer", false],
		["Paneer (Jain).", "Paneer (Jain)", true],
	] as const)(
		"binds the complete new dish %s to candidate %s",
		(sourceDish, affectedItem, want) => {
			expect(
				check(
					"changes",
					{
						...base,
						targetVendor: "tcb",
						changeType: "replacement",
						originalItem: "Poha",
						affectedItem,
					},
					`1/11/26 lunch TCB: replace Poha with ${sourceDish}`,
					[
						...dateSlot,
						["targetVendor", "TCB"],
						["changeType", "replace"],
						["originalItem", "Poha"],
						["affectedItem", affectedItem],
					],
				).ok,
			).toBe(want);
		},
	);
});

function vendorFixture(
	kind: "timings" | "changes" | "swaps",
	vendor: "cheftalk_regular" | "cheftalk_jain" = "cheftalk_regular",
	label = "Cheftalk Jain",
	narrowAll = false,
) {
	const clause =
		kind === "timings"
			? `Today ${label} lunch until 2 PM`
			: kind === "changes"
				? `Today ${label} lunch addition Paneer`
				: `Today ${label} dinner will serve tomorrow lunch menu`;
	const body = narrowAll ? `${label} ${clause.replace(` ${label}`, "")}` : clause;
	const common = { mealDate: "2026-11-01", mealSlot: "lunch" as const, targetVendor: vendor };
	const event =
		kind === "timings"
			? { ...common, extendedTimings: "until 2 PM" }
			: kind === "changes"
				? { ...common, changeType: "addition" as const, affectedItem: "Paneer", originalItem: null }
				: {
						targetMealDate: "2026-11-01",
						targetMealSlot: "dinner" as const,
						sourceMealDate: "2026-11-02",
						sourceMealSlot: "lunch" as const,
						targetVendor: vendor,
					};
	const candidate: Candidate = {
		kind: "operational_announcement",
		announcement: { locations: [], timings: [], changes: [], swaps: [], [kind]: [event] },
	};
	const values: [string, string][] =
		kind === "swaps"
			? [
					["targetMealDate", "Today"],
					["targetMealSlot", "dinner"],
					["sourceMealDate", "tomorrow"],
					["sourceMealSlot", "lunch"],
				]
			: [
					["mealDate", "Today"],
					["mealSlot", "lunch"],
				];
	values.push(["targetVendor", vendor === "cheftalk_jain" ? label : "Cheftalk"]);
	if (kind === "timings") values.push(["extendedTimings", "until 2 PM"]);
	if (kind === "changes") values.push(["changeType", "addition"], ["affectedItem", "Paneer"]);
	const evidence: SourceEvidence[] = values.map(([field, rawValue]) => ({
		fieldPath: `/announcement/${kind}/0/${field}`,
		rawValue,
		clause:
			field === "targetVendor" && vendor === "cheftalk_regular"
				? narrowAll
					? "Cheftalk"
					: "Today Cheftalk"
				: narrowAll
					? body.slice(body.indexOf("Today"))
					: body,
		location: {
			kind: "text",
			start: body.indexOf(rawValue),
			end: body.indexOf(rawValue) + rawValue.length,
		},
	}));
	return {
		candidate,
		evidence,
		source: { ...source, textBody: body, originalCreatedAt: new Date("2026-11-01T00:00:00Z") },
	};
}
it("rejects the reviewed Today Cheftalk Jain timing with narrowed Today Cheftalk vendor evidence", () => {
	const f = vendorFixture("timings");
	f.evidence[2] = { ...f.evidence[2], clause: "Today Cheftalk" };
	expect(f.source.textBody).toBe("Today Cheftalk Jain lunch until 2 PM");
	expect(AnnouncementEvidenceValidator.validate(f.source, f.candidate, f.evidence).ok).toBe(false);
	expect(OperationalAnnouncementValidator.validate(f.candidate, f.source, f.evidence).ok).toBe(
		false,
	);
});
it.each(["timings", "changes", "swaps"] as const)(
	"binds %s vendor qualification across the event's evidence",
	(kind) => {
		const f = vendorFixture(kind);
		expect(OperationalAnnouncementValidator.validate(f.candidate, f.source, f.evidence).ok).toBe(
			false,
		);
	},
);
it.each(["timings", "changes", "swaps"] as const)(
	"binds %s to literal adjacent Jain even when every clause narrows it",
	(kind) => {
		const f = vendorFixture(kind, "cheftalk_regular", "Cheftalk Jain", true);
		expect(OperationalAnnouncementValidator.validate(f.candidate, f.source, f.evidence).ok).toBe(
			false,
		);
	},
);
it.each(["timings", "changes", "swaps"] as const)(
	"retains separate regular and Jain %s events in either source order",
	(kind) => {
		const regular = vendorFixture(kind, "cheftalk_regular", "Cheftalk");
		const jain = vendorFixture(kind, "cheftalk_jain");
		for (const [first, second] of [
			[regular, jain],
			[jain, regular],
		]) {
			const body = `${first.source.textBody}; ${second.source.textBody}`;
			const offset = first.source.textBody.length + 2;
			const evidence = [
				...first.evidence,
				...second.evidence.map((entry) => ({
					...entry,
					fieldPath: entry.fieldPath.replace(`/${kind}/0/`, `/${kind}/1/`),
					location: {
						kind: "text" as const,
						start: (entry.location as { start: number }).start + offset,
						end: (entry.location as { end: number }).end + offset,
					},
				})),
			];
			const candidate: Candidate = {
				...first.candidate,
				announcement: {
					...first.candidate.announcement,
					[kind]: [...first.candidate.announcement[kind], ...second.candidate.announcement[kind]],
				},
			};
			expect(
				OperationalAnnouncementValidator.validate(
					candidate,
					{ ...first.source, textBody: body },
					evidence,
				).ok,
			).toBe(true);
		}
	},
);
it.each(["timings", "changes", "swaps"] as const)(
	"rejects reversed prefix Jain Cheftalk in narrowed %s source evidence",
	(kind) => {
		const f = vendorFixture(kind, "cheftalk_regular", "Jain Cheftalk", true);
		const index = f.evidence.findIndex((e) => e.fieldPath.endsWith("/targetVendor"));
		f.evidence[index] = { ...f.evidence[index], clause: "Cheftalk Today" };
		expect(OperationalAnnouncementValidator.validate(f.candidate, f.source, f.evidence).ok).toBe(
			false,
		);
	},
);
it.each(["timings", "changes", "swaps"] as const)(
	"accepts explicit reversed Jain Cheftalk scope for %s",
	(kind) => {
		const f = vendorFixture(kind, "cheftalk_jain", "Jain Cheftalk");
		expect(OperationalAnnouncementValidator.validate(f.candidate, f.source, f.evidence).ok).toBe(
			true,
		);
	},
);
it("does not confuse a Jain dish label with the regular event's named vendor", () => {
	const f = vendorFixture("changes", "cheftalk_regular", "Cheftalk");
	const body = f.source.textBody.replace("Paneer", "Paneer (Jain)");
	const changes = [{ ...f.candidate.announcement.changes[0], affectedItem: "Paneer (Jain)" }];
	const candidate = { ...f.candidate, announcement: { ...f.candidate.announcement, changes } };
	const evidence = f.evidence.map((entry) => {
		const rawValue = entry.fieldPath.endsWith("/affectedItem") ? "Paneer (Jain)" : entry.rawValue;
		return {
			...entry,
			rawValue,
			clause: body,
			location: {
				kind: "text" as const,
				start: body.indexOf(rawValue),
				end: body.indexOf(rawValue) + rawValue.length,
			},
		};
	});
	expect(
		OperationalAnnouncementValidator.validate(candidate, { ...f.source, textBody: body }, evidence)
			.ok,
	).toBe(true);
});

it("accepts multi-day date range location expansion for holiday announcements", () => {
	const diwaliBody =
		"📢 Lunch will be arranged in the hostel from *6th November 2026 to 12th November 2026* on account of the Diwali holidays.\n\nWishing everyone a very *Happy and Prosperous Diwali!* 🪔✨\n\nHave a wonderful and safe festive break! 🎉";
	const dates = [
		"2026-11-06",
		"2026-11-07",
		"2026-11-08",
		"2026-11-09",
		"2026-11-10",
		"2026-11-11",
		"2026-11-12",
	];
	const locations = dates.map((mealDate) => ({
		mealDate,
		mealSlot: "lunch" as const,
		hostelBatches: ["ALL_BATCHES"],
		collegeBatches: [],
	}));
	const candidate: Candidate = {
		kind: "operational_announcement",
		announcement: {
			locations,
			timings: [],
			changes: [],
			swaps: [],
		},
	};
	const rawDate = "6th November 2026 to 12th November 2026";
	const rawVenue = "in the hostel";
	const rawSlot = "Lunch";
	const clause =
		"📢 Lunch will be arranged in the hostel from *6th November 2026 to 12th November 2026* on account of the Diwali holidays.";
	const evidence: SourceEvidence[] = dates.flatMap((_, i) => [
		{
			fieldPath: `/announcement/locations/${i}/mealDate`,
			rawValue: rawDate,
			clause,
			location: {
				kind: "text",
				start: diwaliBody.indexOf(rawDate),
				end: diwaliBody.indexOf(rawDate) + rawDate.length,
			},
		},
		{
			fieldPath: `/announcement/locations/${i}/mealSlot`,
			rawValue: rawSlot,
			clause,
			location: {
				kind: "text",
				start: diwaliBody.indexOf(rawSlot),
				end: diwaliBody.indexOf(rawSlot) + rawSlot.length,
			},
		},
		{
			fieldPath: `/announcement/locations/${i}/hostelBatches/0`,
			rawValue: rawVenue,
			clause,
			location: {
				kind: "text",
				start: diwaliBody.indexOf(rawVenue),
				end: diwaliBody.indexOf(rawVenue) + rawVenue.length,
			},
		},
	]);
	const res = OperationalAnnouncementValidator.validate(
		candidate,
		{ ...source, textBody: diwaliBody, originalCreatedAt: new Date("2026-11-05T10:00:00Z") },
		evidence,
	);
	expect(res.ok).toBe(true);
	if (res.ok) {
		expect(res.value.locations).toHaveLength(7);
	}
});

it("accepts location allocation with section shorthand and whole-batch exceptions", () => {
	const body =
		"📢 Today (8/11/26), lunch will be arranged in the hostel for all batches except 2029 , 2030 C , D their lunch will be arranged in college.";
	const cand: Candidate = {
		kind: "operational_announcement",
		announcement: {
			locations: [
				{
					mealDate: "2026-11-08",
					mealSlot: "lunch",
					hostelBatches: ["ALL_OTHER_BATCHES"],
					collegeBatches: ["2029", "2030 C", "2030 D"],
				},
			],
			timings: [],
			changes: [],
			swaps: [],
		},
	};
	const ev: SourceEvidence[] = [
		{
			fieldPath: "/announcement/locations/0/mealDate",
			rawValue: "8/11/26",
			clause: body,
			location: { kind: "text", start: 10, end: 17 },
		},
		{
			fieldPath: "/announcement/locations/0/mealSlot",
			rawValue: "lunch",
			clause: body,
			location: { kind: "text", start: 20, end: 25 },
		},
		{
			fieldPath: "/announcement/locations/0/hostelBatches/0",
			rawValue: "all batches except 2029 , 2030 C , D",
			clause: body,
			location: { kind: "text", start: 61, end: 97 },
		},
		{
			fieldPath: "/announcement/locations/0/collegeBatches/0",
			rawValue: "2029",
			clause: body,
			location: { kind: "text", start: 80, end: 84 },
		},
		{
			fieldPath: "/announcement/locations/0/collegeBatches/1",
			rawValue: "2030 C",
			clause: body,
			location: { kind: "text", start: 87, end: 93 },
		},
		{
			fieldPath: "/announcement/locations/0/collegeBatches/2",
			rawValue: "D",
			clause: body,
			location: { kind: "text", start: 96, end: 97 },
		},
	];
	const src: FoodAnnouncementSource = {
		...source,
		textBody: body,
		originalCreatedAt: new Date("2026-11-08T05:07:41Z"),
	};

	const result = OperationalAnnouncementValidator.validate(cand, src, ev);
	expect(result).toEqual({ ok: true, value: cand.announcement });
});

it("accepts location allocation when relative date clause includes Today with numeric date", () => {
	const body =
		"📢 Today (8/11/26), lunch will be arranged in the hostel for all batches except 2029 , 2030 C , D their lunch will be arranged in college.";
	const cand: Candidate = {
		kind: "operational_announcement",
		announcement: {
			locations: [
				{
					mealDate: "2026-11-08",
					mealSlot: "lunch",
					hostelBatches: ["ALL_OTHER_BATCHES"],
					collegeBatches: ["2029", "2030 C", "2030 D"],
				},
			],
			timings: [],
			changes: [],
			swaps: [],
		},
	};
	const ev: SourceEvidence[] = [
		{
			fieldPath: "/announcement/locations/0/mealDate",
			rawValue: "Today (8/11/26)",
			clause: body.slice(3),
			location: { kind: "text", start: 3, end: 18 },
		},
		{
			fieldPath: "/announcement/locations/0/mealSlot",
			rawValue: "lunch",
			clause: body.slice(3),
			location: { kind: "text", start: 20, end: 25 },
		},
		{
			fieldPath: "/announcement/locations/0/hostelBatches/0",
			rawValue: "all batches except 2029 , 2030 C , D",
			clause: body.slice(3),
			location: { kind: "text", start: 61, end: 97 },
		},
		{
			fieldPath: "/announcement/locations/0/collegeBatches/0",
			rawValue: "2029",
			clause: body.slice(3),
			location: { kind: "text", start: 80, end: 84 },
		},
		{
			fieldPath: "/announcement/locations/0/collegeBatches/1",
			rawValue: "2030 C",
			clause: body.slice(3),
			location: { kind: "text", start: 87, end: 93 },
		},
		{
			fieldPath: "/announcement/locations/0/collegeBatches/2",
			rawValue: "D",
			clause: body.slice(3),
			location: { kind: "text", start: 96, end: 97 },
		},
	];
	const src: FoodAnnouncementSource = {
		...source,
		textBody: body,
		originalCreatedAt: new Date("2026-11-08T06:51:25Z"),
	};

	const result = OperationalAnnouncementValidator.validate(cand, src, ev);
	expect(result).toEqual({ ok: true, value: cand.announcement });
});
