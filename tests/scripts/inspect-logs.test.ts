import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
	parseDurationMs,
	parseSinceOption,
	parseCliArgs,
	parseLogLine,
	filterLogEntries,
	formatLogEntry,
	runInspectLogs,
} from "../../scripts/inspect-logs";

describe("inspect-logs helpers", () => {
	describe("parseDurationMs", () => {
		it("parses valid relative duration strings into milliseconds", () => {
			expect(parseDurationMs("30s")).toBe(30_000);
			expect(parseDurationMs("5m")).toBe(300_000);
			expect(parseDurationMs("2h")).toBe(7_200_000);
			expect(parseDurationMs("3d")).toBe(259_200_000);
		});

		it("returns null for invalid duration strings", () => {
			expect(parseDurationMs("invalid")).toBeNull();
			expect(parseDurationMs("")).toBeNull();
			expect(parseDurationMs("-5m")).toBeNull();
		});
	});

	describe("parseSinceOption", () => {
		it("parses relative durations against base timestamp", () => {
			const now = 1730810000000;
			expect(parseSinceOption("5m", now)).toBe(now - 300_000);
			expect(parseSinceOption("1h", now)).toBe(now - 3_600_000);
		});

		it("parses ISO-8601 timestamps into epoch milliseconds", () => {
			const iso = "2026-11-05T12:00:00.000Z";
			expect(parseSinceOption(iso)).toBe(Date.parse(iso));
		});

		it("returns null for invalid since specifications", () => {
			expect(parseSinceOption("not-a-date")).toBeNull();
			expect(parseSinceOption("")).toBeNull();
		});
	});

	describe("parseCliArgs", () => {
		it("defaults tail to 30 when not specified", () => {
			const opts = parseCliArgs([]);
			expect(opts.tail).toBe(30);
		});

		it("parses custom tail, dir, and since arguments", () => {
			const opts = parseCliArgs(["-n", "50", "-d", "custom-logs", "--since", "15m"]);
			expect(opts.tail).toBe(50);
			expect(opts.dir).toBe("custom-logs");
			expect(opts.since).toBe("15m");
		});

		it("allows tail of 0 to mean unbounded", () => {
			const opts = parseCliArgs(["-n", "0"]);
			expect(opts.tail).toBe(0);
		});
	});

	describe("parseLogLine", () => {
		it("parses a valid NDJSON string into an object", () => {
			const line = '{"level":30,"time":1730810000000,"msg":"server started"}';
			const parsed = parseLogLine(line);
			expect(parsed).not.toBeNull();
			expect(parsed?.msg).toBe("server started");
			expect(parsed?.level).toBe(30);
		});

		it("returns null for corrupted or partial JSON lines without throwing", () => {
			expect(parseLogLine('{"level":30,"time":1730810000000,"msg":"serv')).toBeNull();
			expect(parseLogLine("")).toBeNull();
			expect(parseLogLine("random text")).toBeNull();
		});
	});

	describe("filterLogEntries", () => {
		const baseEntries = [
			{ level: 20, time: 1000, msg: "connecting to db", context: { pool: 5 } },
			{ level: 30, time: 2000, msg: "user login", context: { user: "alice" } },
			{ level: 40, time: 3000, msg: "slow query warning", context: { queryTime: 450 } },
			{
				level: 50,
				time: 4000,
				msg: "db connection failed",
				err: { message: "timeout", stack: "Error: timeout\n  at db.ts:1" },
			},
		];

		it("filters by minimum log level", () => {
			const result = filterLogEntries(baseEntries, { level: "warn" });
			expect(result).toHaveLength(2);
			expect(result[0].msg).toBe("slow query warning");
			expect(result[1].msg).toBe("db connection failed");
		});

		it("filters by grep query matching message or context values", () => {
			const result = filterLogEntries(baseEntries, { grep: "alice" });
			expect(result).toHaveLength(1);
			expect(result[0].msg).toBe("user login");
		});

		it("filters by errorsOnly returning only entries with err/error payload", () => {
			const result = filterLogEntries(baseEntries, { errorsOnly: true });
			expect(result).toHaveLength(1);
			expect(result[0].msg).toBe("db connection failed");
		});

		it("limits output to the last N entries via tail", () => {
			const result = filterLogEntries(baseEntries, { tail: 2 });
			expect(result).toHaveLength(2);
			expect(result[0].msg).toBe("slow query warning");
			expect(result[1].msg).toBe("db connection failed");
		});

		it("filters entries by since timestamp", () => {
			const result = filterLogEntries(baseEntries, { sinceTimeMs: 2500 });
			expect(result).toHaveLength(2);
			expect(result[0].msg).toBe("slow query warning");
			expect(result[1].msg).toBe("db connection failed");
		});
	});

	describe("formatLogEntry", () => {
		it("formats standard log entry concisely", () => {
			const entry = {
				level: 30,
				time: 1730810000000,
				msg: "payment processed",
				orderId: "ord-123",
			};
			const formatted = formatLogEntry(entry);
			expect(formatted).toContain("[INFO]");
			expect(formatted).toContain("payment processed");
			expect(formatted).toContain('"orderId":"ord-123"');
		});

		it("formats error log entry with message and stack trace", () => {
			const entry = {
				level: 50,
				time: 1730810000000,
				msg: "unhandled rejection",
				err: {
					type: "DatabaseError",
					message: "connection pool exhausted",
					stack: "DatabaseError: connection pool exhausted\n    at Pool.connect (/app/db.ts:42)",
				},
			};
			const formatted = formatLogEntry(entry);
			expect(formatted).toContain("[ERROR]");
			expect(formatted).toContain("unhandled rejection");
			expect(formatted).toContain("Type: DatabaseError");
			expect(formatted).toContain("Error: connection pool exhausted");
			expect(formatted).toContain("at Pool.connect");
		});
	});

	describe("runInspectLogs", () => {
		const testDir = path.join(process.cwd(), "tmp-test-inspect");
		const testLog = path.join(testDir, "app-2026-11-05T10-00-00.log");

		beforeEach(() => {
			fs.mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
			vi.restoreAllMocks();
		});

		it("warns when nonempty malformed lines are encountered in log file", async () => {
			const content = [
				'{"level":30,"time":1730810000000,"msg":"valid log line"}',
				"corrupted non-json line",
				'{"level":40,"time":1730810001000,"msg":"valid warning"}',
			].join("\n");
			fs.writeFileSync(testLog, content, "utf-8");

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.spyOn(console, "log").mockImplementation(() => {});

			await runInspectLogs({ file: testLog });

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Skipped 1 malformed log line(s)"),
			);
		});

		it("respects custom log directory in options", async () => {
			const content = '{"level":30,"time":1730810000000,"msg":"custom dir entry"}';
			fs.writeFileSync(testLog, content, "utf-8");

			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await runInspectLogs({ dir: testDir });

			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("custom dir entry"));
		});
	});
});
