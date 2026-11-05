import { describe, it, expect } from "vitest";
import {
	parseDurationMs,
	parseLogLine,
	filterLogEntries,
	formatLogEntry,
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
});
