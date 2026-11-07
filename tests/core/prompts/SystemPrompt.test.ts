import { describe, it, expect } from "vitest";
import {
	BASE_PERSONA,
	WHATSAPP_FORMATTING_RULES,
	TOOL_DISCIPLINE_RULES,
	MESS_ROUTING_RULES,
	RESPONSE_CONTRACT_RULES,
	SYSTEM_PROMPT,
} from "../../../src/core/prompts/SystemPrompt";

describe("SystemPrompt Subsystem", () => {
	it("exports non-empty modular prompt sections", () => {
		expect(BASE_PERSONA.trim().length).toBeGreaterThan(0);
		expect(WHATSAPP_FORMATTING_RULES.trim().length).toBeGreaterThan(0);
		expect(TOOL_DISCIPLINE_RULES.trim().length).toBeGreaterThan(0);
		expect(MESS_ROUTING_RULES.trim().length).toBeGreaterThan(0);
		expect(RESPONSE_CONTRACT_RULES.trim().length).toBeGreaterThan(0);
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

	it("contains mandatory live tool call directive for meal inquiries", () => {
		expect(SYSTEM_PROMPT).toContain("Live Food Facts Mandate");
		expect(SYSTEM_PROMPT).toContain(
			"Reusing menu items from conversation history is strictly forbidden",
		);
	});

	it("contains strict response contract and negative boundaries", () => {
		expect(SYSTEM_PROMPT).toContain("Response Contract:");
		expect(SYSTEM_PROMPT).toContain("No Nutritional Speculation");
		expect(SYSTEM_PROMPT).toContain("No Recipe or Taste Inventions");
		expect(SYSTEM_PROMPT).toContain("No Unsolicited Closers");
	});

	it("documents the 4 quadrants and general menu handling in MESS_ROUTING_RULES", () => {
		expect(MESS_ROUTING_RULES).toContain("display_mess_card");
		expect(MESS_ROUTING_RULES).toContain("query_mess_details");
		expect(MESS_ROUTING_RULES).toContain("empty argument payload `{}`");
	});

	it("documents uniform vendor alias mapping and default mess preference rules", () => {
		expect(MESS_ROUTING_RULES).toContain("cheftalk_regular");
		expect(MESS_ROUTING_RULES).toContain("set_default_mess");
		expect(SYSTEM_PROMPT).toContain("set_default_mess");
	});

	it("assembles SYSTEM_PROMPT containing all modular sections", () => {
		expect(SYSTEM_PROMPT).toContain(BASE_PERSONA);
		expect(SYSTEM_PROMPT).toContain(WHATSAPP_FORMATTING_RULES);
		expect(SYSTEM_PROMPT).toContain(TOOL_DISCIPLINE_RULES);
		expect(SYSTEM_PROMPT).toContain(MESS_ROUTING_RULES);
		expect(SYSTEM_PROMPT).toContain(RESPONSE_CONTRACT_RULES);
	});
});
