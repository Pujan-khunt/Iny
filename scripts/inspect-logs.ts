import fs from "fs";
import path from "path";
import readline from "readline";
import { LogFileManager } from "../src/adapters/outbound/logger/LogFileManager";

export interface LogFilterOptions {
	level?: string;
	sinceTimeMs?: number;
	grep?: string;
	errorsOnly?: boolean;
	tail?: number;
}

export interface InspectLogsOptions extends LogFilterOptions {
	file?: string;
	dir?: string;
	follow?: boolean;
	raw?: boolean;
	list?: boolean;
	since?: string;
}

const LEVEL_WEIGHTS: Record<string, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60,
};

export function parseDurationMs(str: string): number | null {
	if (!str || typeof str !== "string") return null;
	const match = str.trim().match(/^(\d+)([smhd])$/);
	if (!match) return null;
	const val = parseInt(match[1], 10);
	const unit = match[2];
	switch (unit) {
		case "s":
			return val * 1000;
		case "m":
			return val * 60_000;
		case "h":
			return val * 3_600_000;
		case "d":
			return val * 86_400_000;
		default:
			return null;
	}
}

export function parseSinceOption(sinceStr: string, nowMs = Date.now()): number | null {
	if (!sinceStr || typeof sinceStr !== "string") return null;
	const durMs = parseDurationMs(sinceStr);
	if (durMs !== null) return nowMs - durMs;
	const parsedDate = Date.parse(sinceStr);
	return Number.isNaN(parsedDate) ? null : parsedDate;
}

export function parseLogLine(line: string): Record<string, unknown> | null {
	if (!line || typeof line !== "string" || !line.trim()) return null;
	try {
		const parsed = JSON.parse(line.trim());
		if (typeof parsed === "object" && parsed !== null) return parsed;
	} catch {
		// Ignore corrupted lines
	}
	return null;
}

export function filterLogEntries(
	entries: Record<string, unknown>[],
	options: LogFilterOptions,
): Record<string, unknown>[] {
	const minLevelWeight = options.level ? (LEVEL_WEIGHTS[options.level.toLowerCase()] ?? 0) : 0;
	const grepRegex = options.grep ? new RegExp(options.grep, "i") : null;

	const filtered = entries.filter((entry) => {
		const entryLevel = typeof entry.level === "number" ? entry.level : 0;
		if (minLevelWeight > 0 && entryLevel < minLevelWeight) return false;
		if (options.sinceTimeMs && typeof entry.time === "number" && entry.time < options.sinceTimeMs) {
			return false;
		}
		if (options.errorsOnly && !entry.err && !entry.error && entryLevel < 50) {
			return false;
		}
		if (grepRegex) {
			const text = `${entry.msg ?? ""} ${JSON.stringify(entry)}`;
			if (!grepRegex.test(text)) return false;
		}
		return true;
	});

	if (options.tail && options.tail > 0 && filtered.length > options.tail) {
		return filtered.slice(filtered.length - options.tail);
	}
	return filtered;
}

export function formatLogEntry(entry: Record<string, unknown>): string {
	const time = typeof entry.time === "number" ? new Date(entry.time).toISOString() : "UNKNOWN_TIME";
	const levelNum = typeof entry.level === "number" ? entry.level : 30;
	const levelStr =
		Object.entries(LEVEL_WEIGHTS)
			.find(([, w]) => w === levelNum)?.[0]
			?.toUpperCase() ?? "INFO";
	const msg = String(entry.msg ?? "");

	const contextObj: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(entry)) {
		if (["level", "time", "msg", "pid", "hostname", "err", "error"].includes(key)) continue;
		contextObj[key] = val;
	}

	const contextStr = Object.keys(contextObj).length > 0 ? " " + JSON.stringify(contextObj) : "";
	let out = `[${time}] [${levelStr}] ${msg}${contextStr}`;

	const errObj = (entry.err ?? entry.error) as Record<string, unknown> | undefined;
	if (errObj && typeof errObj === "object") {
		if (errObj.type) out += `\n  Type: ${String(errObj.type)}`;
		if (errObj.message) out += `\n  Error: ${String(errObj.message)}`;
		if (errObj.stack) {
			const stackLines = String(errObj.stack).split("\n").slice(1).join("\n");
			out += `\n  Stack:\n${stackLines}`;
		}
	}
	return out;
}

export function parseCliArgs(args: string[]): InspectLogsOptions {
	const opts: InspectLogsOptions = { tail: 30 };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-f" || arg === "--file") opts.file = args[++i];
		else if (arg === "-d" || arg === "--dir") opts.dir = args[++i];
		else if (arg === "-n" || arg === "--tail") {
			const val = parseInt(args[++i], 10);
			opts.tail = !Number.isNaN(val) ? val : 30;
		} else if (arg === "-l" || arg === "--level") opts.level = args[++i];
		else if (arg === "-s" || arg === "--since") opts.since = args[++i];
		else if (arg === "-g" || arg === "--grep") opts.grep = args[++i];
		else if (arg === "-e" || arg === "--errors-only") opts.errorsOnly = true;
		else if (arg === "-w" || arg === "--follow") opts.follow = true;
		else if (arg === "-r" || arg === "--raw") opts.raw = true;
		else if (arg === "--list") opts.list = true;
	}
	return opts;
}

function listLogFiles(logDir: string): void {
	const files = fs.existsSync(logDir)
		? fs.readdirSync(logDir).filter((f) => f.startsWith("app-") && f.endsWith(".log"))
		: [];
	console.log(`Available log files in ${logDir}/ (${files.length}):`);
	for (const f of files) console.log(`  - ${path.join(logDir, f)}`);
}

function parseLogEntriesFromFile(filePath: string): Record<string, unknown>[] {
	const lines = fs.readFileSync(filePath, "utf-8").split("\n");
	let malformedCount = 0;
	const entries: Record<string, unknown>[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		const parsed = parseLogLine(line);
		if (parsed) entries.push(parsed);
		else malformedCount++;
	}
	if (malformedCount > 0) {
		console.warn(`[WARN] Skipped ${malformedCount} malformed log line(s).`);
	}
	return entries;
}

export async function runInspectLogs(options: InspectLogsOptions): Promise<void> {
	const logDir = options.dir ?? process.env.LOG_DIR ?? "logs";
	const manager = new LogFileManager(logDir);
	if (options.list) {
		listLogFiles(logDir);
		return;
	}

	const targetFile = options.file ?? manager.resolveLatestLogFile();
	if (!targetFile || !fs.existsSync(targetFile)) {
		console.log("No log entries found matching criteria. (Log file not found)");
		return;
	}

	if (options.since) {
		const sinceMs = parseSinceOption(options.since);
		if (sinceMs !== null) options.sinceTimeMs = sinceMs;
	}

	const entries = parseLogEntriesFromFile(targetFile);
	const matched = filterLogEntries(entries, options);

	if (matched.length === 0 && !options.follow) {
		console.log("No log entries found matching criteria.");
		return;
	}

	for (const entry of matched) {
		console.log(options.raw ? JSON.stringify(entry) : formatLogEntry(entry));
	}

	if (options.follow) {
		await startFollow(targetFile, options);
	}
}

async function startFollow(filePath: string, options: InspectLogsOptions): Promise<void> {
	let currentSize = fs.statSync(filePath).size;
	console.log(`\n--- Following ${filePath} (Press Ctrl+C to stop) ---`);

	setInterval(() => {
		try {
			const stats = fs.statSync(filePath);
			if (stats.size <= currentSize) return;
			const stream = fs.createReadStream(filePath, { start: currentSize, end: stats.size });
			currentSize = stats.size;
			const rl = readline.createInterface({ input: stream });
			rl.on("line", (line) => {
				const entry = parseLogLine(line);
				if (!entry) return;
				const matched = filterLogEntries([entry], options);
				for (const item of matched) {
					console.log(options.raw ? JSON.stringify(item) : formatLogEntry(item));
				}
			});
		} catch {
			// Ignore read polling errors
		}
	}, 250);

	await new Promise(() => {});
}

if (require.main === module) {
	const options = parseCliArgs(process.argv.slice(2));
	runInspectLogs(options).catch((err) => {
		console.error("Error inspecting logs:", err);
		process.exit(1);
	});
}
