import { describe, expect, it } from "vitest";
import { parseWrittenMonthDate } from "../../../src/core/services/WrittenMonthDateParser";

describe("WrittenMonthDateParser", () => {
	it.each([
		["6th November 2026", "2026-11-06"],
		["6 November 2026", "2026-11-06"],
		["November 6, 2026", "2026-11-06"],
		["Nov 6, 2026", "2026-11-06"],
		["6-Nov-2026", "2026-11-06"],
		["12th November 2026", "2026-11-12"],
		["1st Jan 2027", "2027-01-01"],
		["2nd February 2026", "2026-02-02"],
		["3rd March 2026", "2026-03-03"],
		["6th Nov 26", "2026-11-06"],
		["29th February 2024", "2024-02-29"],
	])("parses valid written date %s to %s", (input, expected) => {
		expect(parseWrittenMonthDate(input)).toBe(expected);
	});

	it.each([
		"6 November",
		"November 6th",
		"Nov 6",
		"31st November 2026",
		"29th February 2025",
		"next Sunday",
		"random text",
		"",
	])("rejects invalid or yearless date %s", (input) => {
		expect(parseWrittenMonthDate(input)).toBeNull();
	});
});
