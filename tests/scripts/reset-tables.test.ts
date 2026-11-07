import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSelection, resetSelectedTables } from "../../scripts/reset-tables";

const TABLES = ["dialogue_turns", "mess_meals", "users"];

function createDependencies() {
	return {
		listTables: vi.fn().mockResolvedValue(TABLES),
		truncateTables: vi.fn().mockResolvedValue(undefined),
	};
}

describe("parseSelection", () => {
	it("parses a single number", () => {
		expect(parseSelection("2", 3)).toEqual([2]);
	});

	it("parses comma-separated numbers with whitespace", () => {
		expect(parseSelection(" 3, 1 ", 3)).toEqual([1, 3]);
	});

	it("expands numeric ranges", () => {
		expect(parseSelection("1-3", 3)).toEqual([1, 2, 3]);
	});

	it("deduplicates and sorts overlapping selections", () => {
		expect(parseSelection("3,1-2,2", 3)).toEqual([1, 2, 3]);
	});

	it("rejects empty input", () => {
		expect(() => parseSelection("   ", 3)).toThrow(/at least one/i);
	});

	it("rejects non-numeric tokens", () => {
		expect(() => parseSelection("1,abc", 3)).toThrow(/invalid/i);
	});

	it("rejects out-of-range numbers", () => {
		expect(() => parseSelection("0", 3)).toThrow(/out of range/i);
		expect(() => parseSelection("4", 3)).toThrow(/out of range/i);
	});

	it("rejects inverted ranges", () => {
		expect(() => parseSelection("3-1", 3)).toThrow(/invalid range/i);
	});
});

describe("resetSelectedTables", () => {
	const originalNodeEnv = process.env.NODE_ENV;

	beforeEach(() => {
		process.env.NODE_ENV = "test";
	});

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
	});

	async function run(overrides: Partial<Parameters<typeof resetSelectedTables>[0]> = {}) {
		const dependencies = createDependencies();
		const prints: string[] = [];
		const prompts: string[] = [];
		const answers = ["1,3"];

		const selected = await resetSelectedTables({
			nodeEnv: "development",
			databaseUrl: "postgres://operator:secret@db.host.internal:5432/iny_dev",
			confirmDatabaseName: "iny_dev",
			io: {
				print: (msg) => prints.push(msg),
				prompt: async (query) => {
					prompts.push(query);
					return answers.shift() ?? "";
				},
			},
			dependencies,
			...overrides,
		});

		return { selected, dependencies, prints, prompts };
	}

	it("refuses to run in production before touching the database", async () => {
		const dependencies = createDependencies();

		await expect(
			resetSelectedTables({
				nodeEnv: "production",
				databaseUrl: "postgres://localhost/iny_prod",
				confirmDatabaseName: "iny_prod",
				dependencies,
			}),
		).rejects.toThrow(/production/i);

		expect(dependencies.listTables).not.toHaveBeenCalled();
		expect(dependencies.truncateTables).not.toHaveBeenCalled();
	});

	it("prints the target host and database before destructive work", async () => {
		const { prints } = await run();

		expect(prints.some((p) => p.includes("db.host.internal:5432") && p.includes("iny_dev"))).toBe(
			true,
		);
	});

	it("lists tables with numbers and truncates only selected tables", async () => {
		const { selected, dependencies, prints } = await run();

		expect(selected).toEqual(["dialogue_turns", "users"]);
		expect(dependencies.truncateTables).toHaveBeenCalledWith(["dialogue_turns", "users"]);
		expect(prints.some((p) => p.includes("1. public.dialogue_turns"))).toBe(true);
		expect(prints.some((p) => p.includes("2. public.mess_meals"))).toBe(true);
		expect(prints).toContain("Selected tables:");
		expect(prints).toContain("  - public.dialogue_turns");
		expect(prints).toContain("  - public.users");
	});

	it("prompts for the database name and aborts on a mismatch", async () => {
		const dependencies = createDependencies();

		await expect(
			resetSelectedTables({
				nodeEnv: "development",
				databaseUrl: "postgres://localhost:5432/iny_dev",
				io: {
					print: () => {},
					prompt: async (query) => {
						if (query.includes("Select tables")) return "1";
						return "wrong_name";
					},
				},
				dependencies,
			}),
		).rejects.toThrow(/does not match/i);

		expect(dependencies.truncateTables).not.toHaveBeenCalled();
	});

	it("warns that cascade may clear dependent tables", async () => {
		const { prints } = await run();

		expect(prints.some((p) => p.toUpperCase().includes("CASCADE"))).toBe(true);
	});

	it("fails when the database has no listable tables", async () => {
		const dependencies = createDependencies();
		dependencies.listTables.mockResolvedValue([]);

		await expect(
			resetSelectedTables({
				nodeEnv: "development",
				databaseUrl: "postgres://localhost/iny_dev",
				confirmDatabaseName: "iny_dev",
				dependencies,
			}),
		).rejects.toThrow(/no tables/i);
	});
});
