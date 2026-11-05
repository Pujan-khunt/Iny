import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { LogFileManager } from "../../../../src/adapters/outbound/logger/LogFileManager";

describe("LogFileManager", () => {
	const testDir = path.join(process.cwd(), "tmp-test-log-mgr");

	beforeEach(() => {
		fs.mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("creates log directory and initializes session file with latest pointer", () => {
		const manager = new LogFileManager(testDir, 7);
		const date = new Date("2026-11-05T12:30:45Z");

		const session = manager.initializeSession(date);
		expect(fs.existsSync(session.logFilePath)).toBe(true);
		expect(path.basename(session.logFilePath)).toBe("app-2026-11-05T12-30-45.log");

		const latestTarget = manager.resolveLatestLogFile();
		expect(latestTarget).toBe(session.logFilePath);
	});

	it("prunes files older than retention days and keeps recent files", () => {
		const manager = new LogFileManager(testDir, 7);
		const now = new Date("2026-11-15T12:00:00Z");

		const oldFile = path.join(testDir, "app-2026-11-01T12-00-00.log");
		const recentFile = path.join(testDir, "app-2026-11-12T12-00-00.log");

		fs.writeFileSync(oldFile, "old log");
		fs.writeFileSync(recentFile, "recent log");

		// Set modification times to match timestamps
		const oldMtime = new Date("2026-11-01T12:00:00Z");
		const recentMtime = new Date("2026-11-12T12:00:00Z");
		fs.utimesSync(oldFile, oldMtime, oldMtime);
		fs.utimesSync(recentFile, recentMtime, recentMtime);

		const pruned = manager.pruneOldLogs(now);
		expect(pruned).toContain(oldFile);
		expect(fs.existsSync(oldFile)).toBe(false);
		expect(fs.existsSync(recentFile)).toBe(true);
	});

	it("falls back to finding the latest log file by timestamp when latest.log is missing", () => {
		const manager = new LogFileManager(testDir, 7);
		const file1 = path.join(testDir, "app-2026-11-01T10-00-00.log");
		const file2 = path.join(testDir, "app-2026-11-02T10-00-00.log");

		fs.writeFileSync(file1, "log 1");
		fs.writeFileSync(file2, "log 2");

		fs.utimesSync(file1, new Date("2026-11-01T10:00:00Z"), new Date("2026-11-01T10:00:00Z"));
		fs.utimesSync(file2, new Date("2026-11-02T10:00:00Z"), new Date("2026-11-02T10:00:00Z"));

		const resolved = manager.resolveLatestLogFile();
		expect(resolved).toBe(file2);
	});

	it("resolves regular-file text pointer when symlink is not present", () => {
		const manager = new LogFileManager(testDir, 7);
		const targetLog = path.join(testDir, "app-2026-11-05T10-00-00.log");
		fs.writeFileSync(targetLog, "session content");

		const pointerFile = path.join(testDir, "latest.log");
		fs.writeFileSync(pointerFile, targetLog, "utf-8");

		const resolved = manager.resolveLatestLogFile();
		expect(resolved).toBe(targetLog);
	});

	it("creates unique session log files when multiple boots occur within the same second", () => {
		const manager = new LogFileManager(testDir, 7);
		const date = new Date("2026-11-05T12:30:45Z");

		const session1 = manager.initializeSession(date);
		const session2 = manager.initializeSession(date);

		expect(session1.logFilePath).not.toBe(session2.logFilePath);
		expect(path.basename(session1.logFilePath)).toBe("app-2026-11-05T12-30-45.log");
		expect(path.basename(session2.logFilePath)).toBe("app-2026-11-05T12-30-45-1.log");
		expect(fs.existsSync(session1.logFilePath)).toBe(true);
		expect(fs.existsSync(session2.logFilePath)).toBe(true);
	});

	it("handles non-existent log directory gracefully", () => {
		const nonExistentDir = path.join(process.cwd(), "tmp-non-existent-dir");
		const manager = new LogFileManager(nonExistentDir, 7);

		expect(manager.pruneOldLogs()).toEqual([]);
		expect(manager.resolveLatestLogFile()).toBeNull();
	});
});
