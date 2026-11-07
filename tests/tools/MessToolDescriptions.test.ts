import { describe, it, expect } from "vitest";
import { DisplayMessCardTool } from "../../src/tools/DisplayMessCardTool";
import { QueryMessDetailsTool } from "../../src/tools/QueryMessDetailsTool";
import { MessRepositoryPort } from "../../src/core/ports/MessRepositoryPort";
import { MessCardPresenterPort } from "../../src/core/ports/MessCardPresenterPort";

describe("Mess Tool Descriptions and Schemas", () => {
	const dummyRepo = {} as MessRepositoryPort;
	const dummyPresenter = {} as MessCardPresenterPort;

	it("DisplayMessCardTool documents slot and upcoming rollover handling and single-call terminal nature", () => {
		const tool = new DisplayMessCardTool(dummyRepo, dummyPresenter);
		expect(tool.description).toContain("upcoming meal rollover");
		expect(tool.description).toContain("(1) Slot query");
		expect(tool.description).toContain("(2) Single-vendor slot");
		expect(tool.description).toContain("(3) Generic menu or single-vendor menu");
		expect(tool.description).toContain("(4) Full day menu");
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
		expect(schema.properties?.mealSlot?.description).toContain("all");
		expect(schema.properties?.mealSlot?.description).toContain("upcoming");
		expect(schema.properties?.vendor?.description).toContain("The Craving Brew / Uniworld");
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
		expect(schema.properties?.mealSlot?.description).toContain("all");
		expect(schema.properties?.mealSlot?.description).toContain("upcoming");
		expect(schema.properties?.vendor?.description).toContain("Omit to query across all vendors");
	});
});
