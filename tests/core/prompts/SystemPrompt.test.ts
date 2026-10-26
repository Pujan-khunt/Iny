import { describe, it, expect } from "vitest";
import {
	BASE_PERSONA,
	WHATSAPP_FORMATTING_RULES,
	TOOL_DISCIPLINE_RULES,
	MESS_ROUTING_RULES,
	SYSTEM_PROMPT,
} from "../../../src/core/prompts/SystemPrompt";

describe("SystemPrompt Subsystem", () => {
	it("exports non-empty modular prompt sections", () => {
		expect(BASE_PERSONA.trim().length).toBeGreaterThan(0);
		expect(WHATSAPP_FORMATTING_RULES.trim().length).toBeGreaterThan(0);
		expect(TOOL_DISCIPLINE_RULES.trim().length).toBeGreaterThan(0);
		expect(MESS_ROUTING_RULES.trim().length).toBeGreaterThan(0);
		expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
	});

	it("includes SST campus identity in BASE_PERSONA", () => {
		expect(BASE_PERSONA).toContain("Scaler School of Technology");
		expect(BASE_PERSONA).toContain("SST");
	});

	it("specifies official WhatsApp markdown rules and prohibitions", () => {
		expect(WHATSAPP_FORMATTING_RULES).toContain("*bold*");
		expect(WHATSAPP_FORMATTING_RULES).toContain("_italic_");
		expect(WHATSAPP_FORMATTING_RULES).toContain("~strikethrough~");
		expect(WHATSAPP_FORMATTING_RULES).toContain("```monospace```");
		expect(WHATSAPP_FORMATTING_RULES).toContain("Never use Markdown `#` headings");
		expect(WHATSAPP_FORMATTING_RULES).toContain("Never use Markdown tables");
		expect(WHATSAPP_FORMATTING_RULES).toContain("Never use double asterisks");
	});

	it("enforces mess tool discipline and guardrails against speculative calls", () => {
		expect(TOOL_DISCIPLINE_RULES).toContain("display_mess_card");
		expect(TOOL_DISCIPLINE_RULES).toContain(
			"Never call `display_mess_card` speculatively in parallel",
		);
		expect(TOOL_DISCIPLINE_RULES).toContain("omit");
	});

	it("documents the 4 quadrants and general menu handling in MESS_ROUTING_RULES", () => {
		expect(MESS_ROUTING_RULES).toContain("display_mess_card");
		expect(MESS_ROUTING_RULES).toContain("query_mess_details");
		expect(MESS_ROUTING_RULES).toContain("empty argument payload `{}`");
	});

	it("assembles SYSTEM_PROMPT containing all modular sections", () => {
		expect(SYSTEM_PROMPT).toContain(BASE_PERSONA);
		expect(SYSTEM_PROMPT).toContain(WHATSAPP_FORMATTING_RULES);
		expect(SYSTEM_PROMPT).toContain(TOOL_DISCIPLINE_RULES);
		expect(SYSTEM_PROMPT).toContain(MESS_ROUTING_RULES);
	});
});
