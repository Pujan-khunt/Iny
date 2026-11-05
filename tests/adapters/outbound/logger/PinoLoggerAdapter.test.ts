import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pino from "pino";
import fs from "fs";
import path from "path";
import { Writable } from "node:stream";
import { PinoLoggerAdapter } from "../../../../src/adapters/outbound/logger/PinoLoggerAdapter";

describe("PinoLoggerAdapter", () => {
	let logs: Record<string, unknown>[];
	let adapter: PinoLoggerAdapter;

	const setupLogger = (level: string = "debug") => {
		logs = [];
		const stream = new Writable({
			write(chunk, _encoding, callback) {
				logs.push(JSON.parse(chunk.toString()));
				callback();
			},
		});
		const basePino = pino({ level }, stream);
		adapter = new PinoLoggerAdapter(level, basePino);
	};

	beforeEach(() => {
		setupLogger("debug");
	});

	it("should emit info logs with message and context", () => {
		adapter.info("User connected", { userId: "u123" });

		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe(30); // pino info level
		expect(logs[0].msg).toBe("User connected");
		expect(logs[0].userId).toBe("u123");
	});

	it("should emit debug logs with message and context", () => {
		adapter.debug("Debugging detail", { step: 1 });

		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe(20); // debug
		expect(logs[0].msg).toBe("Debugging detail");
		expect(logs[0].step).toBe(1);
	});

	it("should emit debug and info logs with only message", () => {
		adapter.debug("Simple debug message");
		adapter.info("Simple info message");

		expect(logs).toHaveLength(2);
		expect(logs[0].level).toBe(20);
		expect(logs[0].msg).toBe("Simple debug message");
		expect(logs[1].level).toBe(30);
		expect(logs[1].msg).toBe("Simple info message");
	});

	it("should emit warn logs with optional error and context", () => {
		adapter.warn("Simple warning");
		adapter.warn("Warning with context", undefined, { reason: "slow" });

		const warnErr = new Error("Disk getting full");
		adapter.warn("Storage warning", warnErr, { disk: "/dev/sda1" });

		expect(logs).toHaveLength(3);
		expect(logs[0].level).toBe(40);
		expect(logs[0].msg).toBe("Simple warning");
		expect(logs[0].err).toBeUndefined();

		expect(logs[1].level).toBe(40);
		expect(logs[1].msg).toBe("Warning with context");
		expect(logs[1].reason).toBe("slow");
		expect(logs[1].err).toBeUndefined();

		expect(logs[2].level).toBe(40);
		expect(logs[2].msg).toBe("Storage warning");
		expect(logs[2].disk).toBe("/dev/sda1");
		const err = logs[2].err as Record<string, unknown>;
		expect(err.message).toBe("Disk getting full");
	});

	it("should filter logs below configured log level", () => {
		setupLogger("info");

		adapter.debug("This should be ignored");
		adapter.info("This should be logged");

		expect(logs).toHaveLength(1);
		expect(logs[0].msg).toBe("This should be logged");
	});

	it("should handle error with Error object and context", () => {
		const testError = new Error("Database connection failed");

		adapter.error("Operation failed", testError, { attempt: 3 });

		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe(50); // error
		expect(logs[0].msg).toBe("Operation failed");
		expect(logs[0].attempt).toBe(3);
		expect(logs[0].err).toBeDefined();
		const err = logs[0].err as Record<string, unknown>;
		expect(err.message).toBe("Database connection failed");
		expect(err.stack).toBeDefined();
	});

	it("should ensure explicit Error object takes precedence if context contains an err key", () => {
		const testError = new Error("Explicit failure");

		adapter.error("Operation failed", testError, { err: "shadowed value", attempt: 1 });

		expect(logs).toHaveLength(1);
		expect(logs[0].attempt).toBe(1);
		const err = logs[0].err as Record<string, unknown>;
		expect(err.message).toBe("Explicit failure");
	});

	it("should handle error with only Error object", () => {
		const testError = new Error("Network timeout");

		adapter.error("Request failed", testError);

		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe(50);
		expect(logs[0].msg).toBe("Request failed");
		expect(logs[0].err).toBeDefined();
		const err = logs[0].err as Record<string, unknown>;
		expect(err.message).toBe("Network timeout");
	});

	it("should handle error with only message", () => {
		adapter.error("Simple error occurred");

		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe(50);
		expect(logs[0].msg).toBe("Simple error occurred");
		expect(logs[0].err).toBeUndefined();
	});

	it("should handle fatal with Error object and context", () => {
		const fatalError = new Error("Out of memory");

		adapter.fatal("Process crashing", fatalError, { exitCode: 1 });

		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe(60); // fatal
		expect(logs[0].msg).toBe("Process crashing");
		expect(logs[0].exitCode).toBe(1);
		expect(logs[0].err).toBeDefined();
		const err = logs[0].err as Record<string, unknown>;
		expect(err.message).toBe("Out of memory");
	});

	it("should handle fatal with only Error object", () => {
		const fatalError = new Error("Out of memory");

		adapter.fatal("Process crashing", fatalError);

		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe(60);
		expect(logs[0].msg).toBe("Process crashing");
		expect(logs[0].err).toBeDefined();
		const err = logs[0].err as Record<string, unknown>;
		expect(err.message).toBe("Out of memory");
	});

	it("should handle fatal with only message", () => {
		adapter.fatal("Unrecoverable failure");

		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe(60);
		expect(logs[0].msg).toBe("Unrecoverable failure");
		expect(logs[0].err).toBeUndefined();
	});

	it("should use default constructor parameters when none are passed", () => {
		const defaultAdapter = new PinoLoggerAdapter();
		expect(defaultAdapter).toBeInstanceOf(PinoLoggerAdapter);
	});

	it("should handle child loggers with propagated bindings", () => {
		const childLogger = adapter.child({ correlationId: "corr-999" });
		childLogger.info("Child event", { extra: "data" });

		expect(logs).toHaveLength(1);
		expect(logs[0].msg).toBe("Child event");
		expect(logs[0].correlationId).toBe("corr-999");
		expect(logs[0].extra).toBe("data");
	});

	describe("multistream", () => {
		const testDir = path.join(process.cwd(), "tmp-pino-logs");
		const testFile = path.join(testDir, "test.log");

		beforeEach(() => {
			fs.mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});

		it("writes valid newline-delimited JSON to target log file", async () => {
			const multiAdapter = PinoLoggerAdapter.createWithMultistream({
				level: "info",
				toFile: true,
				logFilePath: testFile,
				prettyConsole: false,
			});

			multiAdapter.info("test message 1", { component: "auth" });
			multiAdapter.warn("test warning", new Error("boom"), { component: "db" });

			await new Promise((r) => setTimeout(r, 100));

			expect(fs.existsSync(testFile)).toBe(true);
			const content = fs.readFileSync(testFile, "utf-8").trim();
			const lines = content.split("\n").map((l) => JSON.parse(l));

			expect(lines.length).toBe(2);
			expect(lines[0].msg).toBe("test message 1");
			expect(lines[0].component).toBe("auth");
			expect(lines[1].msg).toBe("test warning");
			expect((lines[1].err as Record<string, unknown>).message).toBe("boom");
		});

		it("flushes and closes file stream when flush is called", async () => {
			const multiAdapter = PinoLoggerAdapter.createWithMultistream({
				level: "info",
				toFile: true,
				logFilePath: testFile,
				prettyConsole: false,
			});

			multiAdapter.info("flush test message");
			await multiAdapter.flush();

			expect(fs.existsSync(testFile)).toBe(true);
			const content = fs.readFileSync(testFile, "utf-8").trim();
			expect(content).toContain("flush test message");
		});

		it("creates adapter from config with file logging disabled", () => {
			const adapter = PinoLoggerAdapter.createFromConfig({
				LOG_LEVEL: "info",
				LOG_TO_FILE: false,
				LOG_DIR: testDir,
				LOG_RETENTION_DAYS: 7,
				LOG_PRETTY_CONSOLE: false,
			});
			expect(adapter).toBeInstanceOf(PinoLoggerAdapter);
		});

		it("creates adapter from config with file logging disabled and pretty console enabled", () => {
			const adapter = PinoLoggerAdapter.createFromConfig({
				LOG_LEVEL: "info",
				LOG_TO_FILE: false,
				LOG_DIR: testDir,
				LOG_RETENTION_DAYS: 7,
				LOG_PRETTY_CONSOLE: true,
			});
			expect(adapter).toBeInstanceOf(PinoLoggerAdapter);
		});

		it("creates adapter from config with file logging enabled", async () => {
			const adapter = PinoLoggerAdapter.createFromConfig({
				LOG_LEVEL: "info",
				LOG_TO_FILE: true,
				LOG_DIR: testDir,
				LOG_RETENTION_DAYS: 7,
				LOG_PRETTY_CONSOLE: false,
			});
			expect(adapter).toBeInstanceOf(PinoLoggerAdapter);
			adapter.info("config boot test");
			await new Promise((r) => setTimeout(r, 50));
			expect(fs.readdirSync(testDir).some((f) => f.startsWith("app-"))).toBe(true);
		});
	});
});
