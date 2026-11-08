import { describe, expect, it } from "vitest";
import { foodVerificationPrompt } from "../../../../../src/adapters/outbound/mess/extraction/FoodVerificationPrompt";
import {
	operationalExtractionPrompt,
	operationalPromptVersion,
} from "../../../../../src/adapters/outbound/mess/extraction/OperationalExtractionPrompt";
import {
	weeklyMenuExtractionPrompt,
	weeklyMenuPromptVersion,
} from "../../../../../src/adapters/outbound/mess/extraction/WeeklyMenuExtractionPrompt";

describe("Medium-Specific Prompts", () => {
	it("exports distinct prompt versions", () => {
		expect(operationalPromptVersion).toBe("operational-assessment-v1");
		expect(weeklyMenuPromptVersion).toBe("weekly-menu-v1");
	});

	it("operational prompt focuses on operational events and campus-wide allocation", () => {
		expect(operationalExtractionPrompt).toContain("locations");
		expect(operationalExtractionPrompt).toContain("timings");
		expect(operationalExtractionPrompt).toContain("changes");
		expect(operationalExtractionPrompt).toContain("swaps");
		expect(operationalExtractionPrompt).toContain("ALL_BATCHES");
		expect(operationalExtractionPrompt).toContain("section letters");
		expect(operationalExtractionPrompt).not.toContain("21 unique");
	});

	it("weekly menu prompt focuses on 7-day vendor menu tables", () => {
		expect(weeklyMenuExtractionPrompt).toContain("weekly_menu");
		expect(weeklyMenuExtractionPrompt).toContain("21 unique");
		expect(weeklyMenuExtractionPrompt).toContain("cheftalk_regular");
		expect(weeklyMenuExtractionPrompt).toContain("fieldPath");
		expect(weeklyMenuExtractionPrompt).toContain("rawValue");
		expect(weeklyMenuExtractionPrompt).toContain("clause");
		expect(weeklyMenuExtractionPrompt).not.toContain("whole-meal swaps");
	});

	it("verification prompt permits section shorthand expansion for batch tokens", () => {
		expect(foodVerificationPrompt).toContain("2030 D");
		expect(foodVerificationPrompt).toContain("expanding shorthand section letters");
	});
});
