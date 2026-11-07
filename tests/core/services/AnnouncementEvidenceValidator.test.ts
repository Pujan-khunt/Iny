import { describe, expect, it } from "vitest";
import type {
	FoodAnnouncementSource,
	FoodCandidate,
	SourceEvidence,
} from "../../../src/core/entities/FoodAnnouncement";
import { AnnouncementEvidenceValidator } from "../../../src/core/services/AnnouncementEvidenceValidator";

const candidate: Extract<FoodCandidate, { kind: "weekly_menu" }> = {
	kind: "weekly_menu",
	dateRange: { start: "2026-11-01", end: "2026-11-07" },
	menu: { vendor: "tcb", meals: [{ mealDate: "2026-11-01", mealSlot: "lunch", items: ["Poha"] }] },
};
const text = "Uniworld 1/11/26 7/11/26 lunch Poha";
const source: FoodAnnouncementSource = {
	messageId: "m",
	groupJid: "g",
	senderAddress: "s",
	senderAddressType: "pn",
	deliveryMode: "notify",
	originalCreatedAt: new Date("2026-10-31T10:00:00Z"),
	capturedAt: new Date(),
	messageType: "image",
	textBody: text,
	mediaMimeType: "image/png",
	mediaBytes: new Uint8Array([1]),
};
function fixture(): SourceEvidence[] {
	return [
		["/menu/vendor", "Uniworld"],
		["/dateRange/start", "1/11/26"],
		["/dateRange/end", "7/11/26"],
		["/menu/meals/0/mealDate", "1/11/26"],
		["/menu/meals/0/mealSlot", "lunch"],
		["/menu/meals/0/items/0", "Poha"],
	].map(([fieldPath, rawValue]) => ({
		fieldPath,
		rawValue,
		clause: rawValue,
		location: {
			kind: "text",
			start: text.indexOf(rawValue),
			end: text.indexOf(rawValue) + rawValue.length,
		},
	}));
}
describe("AnnouncementEvidenceValidator", () => {
	it("accepts exact source spans and supported transformations", () => {
		expect(AnnouncementEvidenceValidator.validate(source, candidate, fixture()).ok).toBe(true);
	});
	it.each([
		"fabricated span",
		"negative span",
		"fractional span",
		"out of bounds",
		"missing vendor",
		"missing date",
		"invalid path",
		"wrong value",
		"fabricated clause",
	])("rejects %s", (problem) => {
		const records = fixture();
		if (problem === "fabricated span") records[5] = { ...records[5], rawValue: "Paneer" };
		if (problem === "negative span")
			records[5] = { ...records[5], location: { kind: "text", start: -4, end: 0 } };
		if (problem === "fractional span")
			records[5] = { ...records[5], location: { kind: "text", start: 28.5, end: 32 } };
		if (problem === "out of bounds")
			records[5] = { ...records[5], location: { kind: "text", start: 28, end: 1000 } };
		if (problem === "missing vendor") records.shift();
		if (problem === "missing date") records.splice(1, 1);
		if (problem === "invalid path")
			records[5] = { ...records[5], fieldPath: "/menu/meals/0/items/9" };
		if (problem === "wrong value") records[5] = { ...records[4], fieldPath: records[5].fieldPath };
		if (problem === "fabricated clause") records[5] = { ...records[5], clause: "Tomorrow Paneer" };
		expect(AnnouncementEvidenceValidator.validate(source, candidate, records).ok).toBe(false);
	});
	it("accepts a weekly menu when dish items have no individual evidence records", () => {
		const records = fixture().filter((e) => !e.fieldPath.includes("/items/"));
		expect(AnnouncementEvidenceValidator.validate(source, candidate, records).ok).toBe(true);
	});
	it("accepts a weekly menu when only root anchors (/menu/vendor, /dateRange/start, /dateRange/end) have evidence", () => {
		const anchorsOnly = fixture().filter((e) => !e.fieldPath.startsWith("/menu/meals/"));
		expect(AnnouncementEvidenceValidator.validate(source, candidate, anchorsOnly).ok).toBe(true);
	});
	it("rejects conflicting records even if another record supports the field", () => {
		const records = fixture();
		records.push({ ...records[2], fieldPath: "/dateRange/start" });
		expect(AnnouncementEvidenceValidator.validate(source, candidate, records).ok).toBe(false);
	});
	it.each([0, 2])("rejects image evidence outside page one (%s)", (page) => {
		const records = fixture();
		records[5] = {
			...records[5],
			location: { kind: "image", page: page as 1, row: "r", column: "c" },
		};
		expect(AnnouncementEvidenceValidator.validate(source, candidate, records).ok).toBe(false);
	});
	it("requires nonblank image cell identity", () => {
		const records = fixture();
		records[5] = { ...records[5], location: { kind: "image", page: 1, row: "", column: "c" } };
		expect(AnnouncementEvidenceValidator.validate(source, candidate, records).ok).toBe(false);
	});
	it("accepts page-one image cells while requiring every field", () => {
		const evidence = fixture().map((e): SourceEvidence => ({
			...e,
			location: { kind: "image", page: 1, row: "lunch", column: "Sunday" },
		}));
		expect(AnnouncementEvidenceValidator.validate(source, candidate, evidence).ok).toBe(true);
	});
});

function completeRange() {
	const c = {
		...candidate,
		dateRange: { ...candidate.dateRange },
		menu: {
			vendor: "tcb" as const,
			meals: Array.from({ length: 21 }, (_, i) => ({
				mealDate: `2026-11-0${Math.floor(i / 3) + 1}`,
				mealSlot: ["breakfast", "lunch", "dinner"][i % 3] as "lunch",
				items: ["Poha"],
			})),
		},
	};
	const header = "Uniworld weekly menu 1/11/26 to 7/11/26";
	const e: SourceEvidence[] = [
		["/menu/vendor", "Uniworld"],
		["/dateRange/start", "1/11/26"],
		["/dateRange/end", "7/11/26"],
		...c.menu.meals.flatMap((m, i) => [
			[`/menu/meals/${i}/mealDate`, "1/11/26"],
			[`/menu/meals/${i}/mealSlot`, m.mealSlot],
			[`/menu/meals/${i}/items/0`, "Poha"],
		]),
	].map(([fieldPath, rawValue]) => ({
		fieldPath,
		rawValue,
		clause:
			fieldPath.endsWith("mealDate") || fieldPath.startsWith("/dateRange") ? header : rawValue,
		location: {
			kind: "image",
			page: 1,
			row: "header",
			column: rawValue === "1/11/26" ? "start" : rawValue,
		},
	}));
	return { c, e };
}
it("derives interior menu dates from genuine complete range header witnesses", () => {
	const { c, e } = completeRange();
	expect(AnnouncementEvidenceValidator.validate(source, c, e).ok).toBe(true);
});
it("accepts a complete weekly menu when mealSlot evidence is omitted", () => {
	const { c, e } = completeRange();
	const withoutMealSlots = e.filter((entry) => !entry.fieldPath.endsWith("/mealSlot"));
	expect(AnnouncementEvidenceValidator.validate(source, c, withoutMealSlots).ok).toBe(true);
});
it.each([
	"missing end",
	"unbacked end",
	"outside range",
	"bad witness",
	"conflicting date",
	"long range",
])("rejects range derivation with %s", (problem) => {
	const { c, e } = completeRange();
	if (problem === "missing end") e.splice(2, 1);
	if (problem === "unbacked end") e[2] = { ...e[2], rawValue: "8/11/26" };
	if (problem === "outside range") c.menu.meals[3].mealDate = "2026-11-08";
	if (problem === "bad witness")
		e[12] = { ...e[12], location: { kind: "image", page: 1, row: "daily row", column: "date" } };
	if (problem === "conflicting date") e.push({ ...e[6], rawValue: "3/11/26" });
	if (problem === "long range") Object.assign(c.dateRange, { end: "2026-11-08" });
	expect(AnnouncementEvidenceValidator.validate(source, c, e).ok).toBe(false);
});
it.each([
	["cheftalk_regular", "Cheftalk", "Cheftalk", true],
	["cheftalk_regular", "Cheftalk general", "Cheftalk general", true],
	["cheftalk_regular", "Cheftalk regular", "Cheftalk regular", true],
	["cheftalk_jain", "Cheftalk Jain", "Cheftalk Jain", true],
	["cheftalk_regular", "Cheftalk", "Cheftalk Jain", false],
	["cheftalk_regular", "Cheftalk Jain", "Cheftalk Jain", false],
	["cheftalk_jain", "Cheftalk", "Cheftalk", false],
	["tcb", "THE CRAVING BREW", "THE CRAVING BREW", true],
	["tcb", "The Craving Brew", "The Craving Brew", true],
	["tcb", "Craving Brew", "Craving Brew", true],
	["tcb", "TCB", "TCB", true],
	["tcb", "Uniworld", "Uniworld", true],
] as const)("requires exact vendor scope %s / %s / %s", (vendor, rawValue, clause, want) => {
	const c = { ...candidate, menu: { ...candidate.menu, vendor } };
	const e = fixture();
	e[0] = {
		...e[0],
		rawValue,
		clause,
		location: { kind: "image", page: 1, row: "header", column: "vendor" },
	};
	expect(AnnouncementEvidenceValidator.validate(source, c, e).ok).toBe(want);
});

it("does not erase a literal Jain qualification by narrowing the evidence clause", () => {
	const c = { ...candidate, menu: { ...candidate.menu, vendor: "cheftalk_regular" as const } };
	const text = "Cheftalk Jain 1/11/26 7/11/26 lunch Poha";
	const e = fixture().map((entry) => {
		const rawValue = entry.fieldPath === "/menu/vendor" ? "Cheftalk" : entry.rawValue;
		return {
			...entry,
			rawValue,
			clause: rawValue,
			location: {
				kind: "text" as const,
				start: text.indexOf(rawValue),
				end: text.indexOf(rawValue) + rawValue.length,
			},
		};
	});
	expect(AnnouncementEvidenceValidator.validate({ ...source, textBody: text }, c, e).ok).toBe(
		false,
	);
});

it("checks literal identity of both range bounds even when daily dates use a header witness", () => {
	const { c, e } = completeRange();
	const body = "Uniworld weekly menu 1/11/26 to 7/11/26 breakfast lunch dinner Poha";
	const records = e.map((entry) => ({
		...entry,
		location: {
			kind: "text" as const,
			start: body.indexOf(entry.rawValue),
			end: body.indexOf(entry.rawValue) + entry.rawValue.length,
		},
	}));
	expect(AnnouncementEvidenceValidator.validate({ ...source, textBody: body }, c, records).ok).toBe(
		true,
	);
	records[2] = { ...records[2], location: { kind: "text", start: 0, end: 7 } };
	expect(AnnouncementEvidenceValidator.validate({ ...source, textBody: body }, c, records).ok).toBe(
		false,
	);
});

it("accepts venue clause evidence for campus-wide ALL_BATCHES when no cohorts are named", () => {
	const body = "Lunch will be arranged in the hostel from 6th November 2026 to 12th November 2026.";
	const operationalCandidate: FoodCandidate = {
		kind: "operational_announcement",
		announcement: {
			locations: [
				{
					mealDate: "2026-11-06",
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
	const rawVenue = "in the hostel";
	const rawDate = "6th November 2026 to 12th November 2026";
	const rawSlot = "Lunch";
	const evidence: SourceEvidence[] = [
		{
			fieldPath: "/announcement/locations/0/mealDate",
			rawValue: rawDate,
			clause: body,
			location: {
				kind: "text",
				start: body.indexOf(rawDate),
				end: body.indexOf(rawDate) + rawDate.length,
			},
		},
		{
			fieldPath: "/announcement/locations/0/mealSlot",
			rawValue: rawSlot,
			clause: body,
			location: {
				kind: "text",
				start: body.indexOf(rawSlot),
				end: body.indexOf(rawSlot) + rawSlot.length,
			},
		},
		{
			fieldPath: "/announcement/locations/0/hostelBatches/0",
			rawValue: rawVenue,
			clause: body,
			location: {
				kind: "text",
				start: body.indexOf(rawVenue),
				end: body.indexOf(rawVenue) + rawVenue.length,
			},
		},
	];
	const opSource: FoodAnnouncementSource = {
		...source,
		messageType: "text",
		textBody: body,
		originalCreatedAt: new Date("2026-11-06T04:00:00Z"),
	};
	expect(AnnouncementEvidenceValidator.validate(opSource, operationalCandidate, evidence).ok).toBe(
		true,
	);
});
