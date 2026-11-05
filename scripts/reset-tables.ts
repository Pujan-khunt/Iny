import readline from "node:readline/promises";
import postgres from "postgres";
import { loadConfig } from "../src/config";

export interface ResetTablesIo {
	print?: (message: string) => void;
	prompt?: (query: string) => Promise<string>;
}

export interface ResetTablesDependencies {
	listTables: () => Promise<string[]>;
	truncateTables: (tables: string[]) => Promise<void>;
}

export interface ResetSelectedTablesOptions {
	nodeEnv?: string;
	databaseUrl?: string;
	confirmDatabaseName?: string;
	io?: ResetTablesIo;
	dependencies: ResetTablesDependencies;
}

export function parseSelection(input: string, count: number): number[] {
	const tokens = input
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean);

	if (tokens.length === 0) {
		throw new Error("Select at least one table number.");
	}

	const selected = new Set<number>();
	for (const token of tokens) {
		for (const number of expandToken(token)) {
			if (number < 1 || number > count) {
				throw new Error(`Selection out of range: ${number}. Choose 1-${count}.`);
			}
			selected.add(number);
		}
	}

	return [...selected].sort((a, b) => a - b);
}

function expandToken(token: string): number[] {
	const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
	if (range) {
		const start = Number(range[1]);
		const end = Number(range[2]);
		if (start > end) {
			throw new Error(`Invalid range: "${token}". Start must not exceed end.`);
		}
		return Array.from({ length: end - start + 1 }, (_, index) => start + index);
	}

	if (!/^\d+$/.test(token)) {
		throw new Error(`Invalid selection token: "${token}". Use numbers or ranges like 1,3-5.`);
	}

	return [Number(token)];
}

export async function resetSelectedTables(options: ResetSelectedTablesOptions): Promise<string[]> {
	const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
	if (nodeEnv?.trim().toLowerCase() === "production") {
		throw new Error("Refusing to run destructive reset in production environment.");
	}

	const { host, dbName } = parseDatabaseTarget(options.databaseUrl ?? process.env.DATABASE_URL);
	options.io?.print?.(`⚠️ TARGET DATABASE: postgres://...@${host}/${dbName}`);

	const tables = await options.dependencies.listTables();
	if (tables.length === 0) {
		throw new Error("No tables found to reset.");
	}

	printNumberedTables(tables, options.io);
	const answer = await promptForSelection(options.io);
	const selected = parseSelection(answer, tables.length).map((number) => tables[number - 1]);

	printTableLines("Selected tables:", selected, options.io);
	options.io?.print?.(
		"⚠️ TRUNCATE ... RESTART IDENTITY CASCADE also clears rows in tables that reference the selection.",
	);
	await confirmTarget(options, dbName);

	await options.dependencies.truncateTables(selected);
	printTableLines(`Successfully reset ${selected.length} table(s):`, selected, options.io);

	return selected;
}

function printTableLines(title: string, tables: string[], io: ResetTablesIo | undefined): void {
	io?.print?.(title);
	tables.forEach((table) => {
		io?.print?.(`  - public.${table}`);
	});
}

function printNumberedTables(tables: string[], io: ResetTablesIo | undefined): void {
	io?.print?.("Tables available for reset:");
	tables.forEach((table, index) => {
		io?.print?.(`  ${index + 1}. public.${table}`);
	});
}

async function promptForSelection(io: ResetTablesIo | undefined): Promise<string> {
	if (!io?.prompt) {
		throw new Error("Interactive prompt is required to select tables.");
	}
	return io.prompt("Select tables by number (e.g. 1,3,5 or 2-4): ");
}

function parseDatabaseTarget(databaseUrl: string | undefined) {
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required to perform reset.");
	}

	let parsed: URL;
	try {
		parsed = new URL(databaseUrl);
	} catch {
		throw new Error(`Invalid database URL: "${databaseUrl}"`);
	}

	const dbName = parsed.pathname.replace(/^\//, "").split("?")[0];
	if (!dbName) {
		throw new Error(`Unable to extract database name from URL: "${databaseUrl}"`);
	}

	return { host: parsed.host || parsed.hostname, dbName };
}

async function confirmTarget(options: ResetSelectedTablesOptions, dbName: string): Promise<void> {
	let confirmName = options.confirmDatabaseName;
	if (confirmName === undefined && options.io?.prompt) {
		const answer = await options.io.prompt(`Type the database name "${dbName}" to confirm wipe: `);
		confirmName = answer?.trim();
	}

	if (confirmName !== dbName) {
		throw new Error(
			`Confirmation name does not match target database name ("${dbName}"). Aborting reset.`,
		);
	}
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

export async function main(): Promise<void> {
	const config = loadConfig();
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const sqlClient = postgres(config.DATABASE_URL, {
		max: 2,
		idle_timeout: 10,
		connect_timeout: 10,
	});

	try {
		await resetSelectedTables({
			nodeEnv: process.env.NODE_ENV,
			databaseUrl: config.DATABASE_URL,
			dependencies: {
				listTables: async () => {
					const rows = await sqlClient<{ table_name: string }[]>`
						SELECT table_name
						FROM information_schema.tables
						WHERE table_schema = 'public'
							AND table_type = 'BASE TABLE'
						ORDER BY table_name
					`;
					return rows.map((row) => row.table_name);
				},
				truncateTables: async (tables) => {
					const targets = tables.map((table) => `"public".${quoteIdentifier(table)}`).join(", ");
					await sqlClient.unsafe(`TRUNCATE TABLE ${targets} RESTART IDENTITY CASCADE`);
				},
			},
			io: {
				print: (message: string) => console.log(message),
				prompt: async (query: string) => rl.question(query),
			},
		});
	} finally {
		rl.close();
		await sqlClient.end();
	}
}

const isDirectExecution = (): boolean => {
	if (process.env.VITEST) return false;
	if (!process.argv[1]) return false;
	return process.argv[1].endsWith("reset-tables.ts") || process.argv[1].endsWith("reset-tables.js");
};

if (isDirectExecution()) {
	main().catch((err) => {
		console.error("Fatal Reset Error:", err instanceof Error ? err.message : err);
		process.exit(1);
	});
}
