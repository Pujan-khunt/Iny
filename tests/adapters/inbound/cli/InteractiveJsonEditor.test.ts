import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { z } from "zod";
import { InteractiveJsonEditor } from "../../../../src/adapters/inbound/cli/InteractiveJsonEditor";

describe("InteractiveJsonEditor", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	describe("resolveEditor", () => {
		it("prefers VISUAL if set", () => {
			process.env.VISUAL = "code --wait";
			process.env.EDITOR = "nano";
			const editor = new InteractiveJsonEditor();
			expect(editor.resolveEditor()).toBe("code --wait");
		});

		it("falls back to EDITOR if VISUAL is unset", () => {
			delete process.env.VISUAL;
			process.env.EDITOR = "nvim";
			const editor = new InteractiveJsonEditor();
			expect(editor.resolveEditor()).toBe("nvim");
		});

		it("defaults to vim if neither VISUAL nor EDITOR is set", () => {
			delete process.env.VISUAL;
			delete process.env.EDITOR;
			const editor = new InteractiveJsonEditor();
			expect(editor.resolveEditor()).toBe("vim");
		});
	});

	describe("editJson", () => {
		const testSchema = z.object({
			title: z.string(),
			count: z.number().int().positive(),
		});

		it("writes initial data, spawns editor, reads and validates edited content", async () => {
			let createdTempFile = "";
			const customSpawnSync = vi.fn((_cmd: string, args: string[]) => {
				createdTempFile = args[0];
				expect(fs.existsSync(createdTempFile)).toBe(true);
				// Simulate user editing the file in vim
				fs.writeFileSync(createdTempFile, JSON.stringify({ title: "Updated Title", count: 42 }));
				return { status: 0 };
			});

			const editor = new InteractiveJsonEditor({
				spawnSyncFn: customSpawnSync as any,
			});

			const result = await editor.editJson({ title: "Initial", count: 1 }, testSchema);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({ title: "Updated Title", count: 42 });
			expect(customSpawnSync).toHaveBeenCalledTimes(1);
			// Ensure temp file is unlinked in finally block
			expect(fs.existsSync(createdTempFile)).toBe(false);
		});

		it("returns cancelled when editor exits with non-zero status", async () => {
			let createdTempFile = "";
			const customSpawnSync = vi.fn((_cmd: string, args: string[]) => {
				createdTempFile = args[0];
				return { status: 1 };
			});

			const editor = new InteractiveJsonEditor({
				spawnSyncFn: customSpawnSync as any,
			});

			const result = await editor.editJson({ title: "Initial", count: 1 }, testSchema);

			expect(result.success).toBe(false);
			expect(result.cancelled).toBe(true);
			expect(fs.existsSync(createdTempFile)).toBe(false);
		});

		it("handles JSON syntax error and allows retry if promptRetry returns true", async () => {
			let attempt = 0;
			let createdTempFile = "";
			const customSpawnSync = vi.fn((_cmd: string, args: string[]) => {
				createdTempFile = args[0];
				attempt++;
				if (attempt === 1) {
					// Syntax error: invalid JSON
					fs.writeFileSync(createdTempFile, "{ invalid json");
				} else {
					// Corrected on retry
					fs.writeFileSync(createdTempFile, JSON.stringify({ title: "Valid Now", count: 10 }));
				}
				return { status: 0 };
			});

			const promptRetry = vi.fn(async () => true);

			const editor = new InteractiveJsonEditor({
				spawnSyncFn: customSpawnSync as any,
				promptRetry,
			});

			const result = await editor.editJson({ title: "Initial", count: 1 }, testSchema);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({ title: "Valid Now", count: 10 });
			expect(promptRetry).toHaveBeenCalledTimes(1);
			expect(customSpawnSync).toHaveBeenCalledTimes(2);
			expect(fs.existsSync(createdTempFile)).toBe(false);
		});

		it("returns schema validation error if validation fails and retry is rejected", async () => {
			let createdTempFile = "";
			const customSpawnSync = vi.fn((_cmd: string, args: string[]) => {
				createdTempFile = args[0];
				// Valid JSON but invalid schema (count must be positive integer)
				fs.writeFileSync(createdTempFile, JSON.stringify({ title: "Test", count: -5 }));
				return { status: 0 };
			});

			const promptRetry = vi.fn(async () => false);

			const editor = new InteractiveJsonEditor({
				spawnSyncFn: customSpawnSync as any,
				promptRetry,
			});

			const result = await editor.editJson({ title: "Initial", count: 1 }, testSchema);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Validation error");
			expect(promptRetry).toHaveBeenCalledTimes(1);
			expect(fs.existsSync(createdTempFile)).toBe(false);
		});

		it("cleans up temp file even when an unexpected exception is thrown", async () => {
			let createdTempFile = "";
			const customSpawnSync = vi.fn((_cmd: string, args: string[]) => {
				createdTempFile = args[0];
				throw new Error("Unexpected OS failure");
			});

			const editor = new InteractiveJsonEditor({
				spawnSyncFn: customSpawnSync as any,
			});

			await expect(editor.editJson({ title: "Initial", count: 1 }, testSchema)).rejects.toThrow(
				"Unexpected OS failure",
			);

			expect(fs.existsSync(createdTempFile)).toBe(false);
		});
	});
});
