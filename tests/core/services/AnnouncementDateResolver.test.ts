import { describe, expect, it } from "vitest";
import { AnnouncementDateResolver } from "../../../src/core/services/AnnouncementDateResolver";

const originalCreatedAt = new Date("2026-11-01T04:00:00Z");

describe("AnnouncementDateResolver", () => {
	it("rejects a conflicting explicit and relative date", () => {
		const result = AnnouncementDateResolver.resolve(
			["Tommorow", "1/11/26"],
			new Date("2026-11-01T04:00:00Z"),
		);
		expect(result).toMatchObject({ ok: false, reason: "conflicting_date" });
	});
	it("resolves against the original IST day across UTC midnight", () => {
		const result = AnnouncementDateResolver.resolve(
			["tomorrow", "1/11/26"],
			new Date("2026-10-30T20:00:00Z"),
		);
		expect(result).toEqual({ ok: true, value: "2026-11-01" });
	});
	it.each([
		["today", "2026-11-01"],
		["yesterday", "2026-10-31"],
		["tomorrow", "2026-11-02"],
		["Tommorow", "2026-11-02"],
		["tmrw", "2026-11-02"],
		["1/11/2026", "2026-11-01"],
		["1,11,2026", "2026-11-01"],
		["7,11,2026", "2026-11-07"],
		["1.11.2026", "2026-11-01"],
		["1-11-2026", "2026-11-01"],
		["01,11,2026", "2026-11-01"],
		["01.11.2026", "2026-11-01"],
		["01-11-2026", "2026-11-01"],
		["1,11,26", "2026-11-01"],
		["1.11.26", "2026-11-01"],
		["1-11-26", "2026-11-01"],
		["2026-11-01", "2026-11-01"],
		["1/11/00", "2000-11-01"],
		["1/11/99", "2099-11-01"],
		["29/2/24", "2024-02-29"],
		["11/02/26", "2026-11-02"],
		["11/08/26", "2026-11-08"],
		["6th November 2026", "2026-11-06"],
		["12th November 2026", "2026-11-12"],
		["Nov 6, 2026", "2026-11-06"],
		["6-Nov-2026", "2026-11-06"],
	])("resolves %s to %s", (reference, value) => {
		expect(AnnouncementDateResolver.resolve([reference], originalCreatedAt)).toEqual({
			ok: true,
			value,
		});
	});
	it("shifts relative dates across a year boundary", () => {
		expect(
			AnnouncementDateResolver.resolve(["tomorrow"], new Date("2026-12-31T04:00:00Z")),
		).toEqual({ ok: true, value: "2027-01-01" });
	});
	it.each([
		{ references: [] },
		{ references: [""] },
		{ references: ["Lunch will be arranged in the hostel"] },
	])("rejects undated references %j", ({ references }) => {
		expect(AnnouncementDateResolver.resolve(references, originalCreatedAt)).toMatchObject({
			ok: false,
			reason: "missing_date",
		});
	});
	it.each([
		"29/2/26",
		"31/11/26",
		"2026-02-29",
		"1/11",
		"1 November",
		"Monday",
		"next Sunday",
		"1/11/202",
		"2026-11-011",
	])("rejects invalid or ambiguous reference %s", (reference) => {
		expect(AnnouncementDateResolver.resolve([reference], originalCreatedAt)).toMatchObject({
			ok: false,
			reason: "invalid_date",
		});
	});
	it("rejects an invalid reference even when another reference is clear", () => {
		expect(
			AnnouncementDateResolver.resolve(["today", "31/11/26"], originalCreatedAt),
		).toMatchObject({ ok: false, reason: "invalid_date" });
	});
	it("detects conflicting dates inside the same raw reference", () => {
		expect(
			AnnouncementDateResolver.resolve(["Tommorow (1/11/26), lunch in hostel"], originalCreatedAt),
		).toMatchObject({ ok: false, reason: "conflicting_date" });
	});
	it("accepts agreeing dates inside the same raw reference", () => {
		expect(
			AnnouncementDateResolver.resolve(["Today (1/11/26), lunch in hostel"], originalCreatedAt),
		).toEqual({ ok: true, value: "2026-11-01" });
	});
	it("does not treat comma-separated batch years as date tokens", () => {
		const text =
			"📢 Today (8/11/26), lunch will be arranged in the hostel for all batches except 2029 , 2030 C , D their lunch will be arranged in college.";
		expect(AnnouncementDateResolver.resolve([text], new Date("2026-11-08T05:00:00Z"))).toEqual({
			ok: true,
			value: "2026-11-08",
		});
	});
	it("detects conflicting relative words inside the same raw reference", () => {
		expect(
			AnnouncementDateResolver.resolve(["today or tomorrow"], originalCreatedAt),
		).toMatchObject({ ok: false, reason: "conflicting_date" });
	});
	it("detects conflicting explicit dates inside the same raw reference", () => {
		expect(
			AnnouncementDateResolver.resolve(["1/11/26 or 2026-11-02"], originalCreatedAt),
		).toMatchObject({ ok: false, reason: "conflicting_date" });
	});
	it.each(["tomorrow (31/11/26)", "tomorrow (2/11)", "tomorrow, 2 November"])(
		"does not ignore invalid or yearless reference inside %s",
		(reference) => {
			expect(AnnouncementDateResolver.resolve([reference], originalCreatedAt)).toMatchObject({
				ok: false,
				reason: "invalid_date",
			});
		},
	);
	it.each([
		"today (November 3rd)",
		"today (November 1st)",
		"today (November 2nd)",
		"today (November 4th)",
		"today (3 / 11 / 2026)",
		"today (3 / 11)",
		"today (3/ 11 /2026)",
	])("rejects previously ignored date evidence inside %s", (reference) => {
		expect(AnnouncementDateResolver.resolve([reference], originalCreatedAt)).toMatchObject({
			ok: false,
			reason: "invalid_date",
		});
	});
	it("rejects an unusable original timestamp", () => {
		expect(AnnouncementDateResolver.resolve(["today"], new Date(NaN))).toMatchObject({
			ok: false,
			reason: "invalid_date",
		});
	});
});

describe("date references in source prose", () => {
	it("does not treat an ordinary may as a month date", () => {
		expect(
			AnnouncementDateResolver.resolve(["Today, lunch may be delayed"], originalCreatedAt),
		).toEqual({ ok: true, value: "2026-11-01" });
	});
	it("rejects a relative date beyond ISO calendar bounds", () => {
		expect(
			AnnouncementDateResolver.resolve(["tomorrow"], new Date("9999-12-31T04:00:00Z")),
		).toMatchObject({ ok: false, reason: "invalid_date" });
	});
	it("does not ignore an unsupported dotted date next to a relative reference", () => {
		expect(AnnouncementDateResolver.resolve(["today (31.11.26)"], originalCreatedAt)).toMatchObject(
			{ ok: false, reason: "invalid_date" },
		);
	});
	it("does not treat unspaced cohort list as a date token", () => {
		expect(
			AnnouncementDateResolver.resolve(
				["today lunch for batches 2028,2029,2030 in hostel"],
				originalCreatedAt,
			),
		).toEqual({ ok: true, value: "2026-11-01" });
	});
	it("detects and rejects spaced comma dates alongside relative dates", () => {
		expect(
			AnnouncementDateResolver.resolve(["today (9, 11, 26)"], originalCreatedAt),
		).toMatchObject({ ok: false, reason: "invalid_date" });
		expect(
			AnnouncementDateResolver.resolve(["today (1, 11, 26)"], originalCreatedAt),
		).toMatchObject({ ok: false, reason: "invalid_date" });
	});
	it("rejects standalone spaced comma date references", () => {
		expect(AnnouncementDateResolver.resolve(["9, 11, 26"], originalCreatedAt)).toMatchObject({
			ok: false,
			reason: "invalid_date",
		});
	});
});
