import { describe, it, expect } from "vitest";
import { DisplayMessCardTool } from "../../src/tools/DisplayMessCardTool";
import { QueryMessDetailsTool } from "../../src/tools/QueryMessDetailsTool";
import { MessRepositoryPort } from "../../src/core/ports/MessRepositoryPort";
import { MessCardPresenterPort } from "../../src/core/ports/MessCardPresenterPort";

describe("Mess Tool Descriptions and Schemas", () => {
	const dummyRepo = {} as MessRepositoryPort;
	const dummyPresenter = {} as MessCardPresenterPort;

	it("DisplayMessCardTool documents 4 quadrants and single-call terminal nature", () => {
		const tool = new DisplayMessCardTool(dummyRepo, dummyPresenter);
		expect(tool.description).toContain("4 presentation quadrants");
		expect(tool.description).toContain("(1) Slot query");
		expect(tool.description).toContain("(2) Single-vendor slot");
		expect(tool.description).toContain("(3) Generic menu");
		expect(tool.description).toContain("(4) Single-vendor full-day");
		expect(tool.description).toContain("terminal");
		expect(tool.description).toContain("never call speculatively in parallel");
	});

	it("DisplayMessCardTool parameter schemas provide precise 4-quadrant routing guidance", () => {
		const tool = new DisplayMessCardTool(dummyRepo, dummyPresenter);
		const schema = tool.definition.schema as {
			properties?: {
				mealDate?: { description?: string };
				mealSlot?: { description?: string };
				vendor?: { description?: string };
			};
		};
		expect(schema.properties?.mealDate?.description).toContain(
			"Provide ONLY when the user explicitly specifies a calendar date",
		);
		expect(schema.properties?.mealSlot?.description).toContain("Omit for general queries");
		expect(schema.properties?.mealSlot?.description).toContain(
			"trigger automatic cutoff and rollover",
		);
		expect(schema.properties?.vendor?.description).toContain("The Culinary Bay / Uniworld");
	});

	it("QueryMessDetailsTool documents dietary analytical query scope", () => {
		const tool = new QueryMessDetailsTool(dummyRepo);
		expect(tool.description).toContain("dietary, ingredient, or comparative questions");
		expect(tool.description).toContain(
			"Do NOT use this tool for showing general menus or meal cards",
		);
	});

	it("QueryMessDetailsTool parameter schemas document analytical query defaults", () => {
		const tool = new QueryMessDetailsTool(dummyRepo);
		const schema = tool.definition.schema as {
			properties?: {
				mealDate?: { description?: string };
				mealSlot?: { description?: string };
				vendor?: { description?: string };
			};
		};
		expect(schema.properties?.mealDate?.description).toContain(
			"Omit to query current or upcoming meal date",
		);
		expect(schema.properties?.mealSlot?.description).toContain(
			"Omit to query all slots for the date",
		);
		expect(schema.properties?.vendor?.description).toContain("Omit to query across all vendors");
	});
});
