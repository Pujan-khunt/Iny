import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { MediaPreviewer } from "../../../../src/adapters/inbound/cli/MediaPreviewer";

describe("MediaPreviewer", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("determines extension from filename or mimeType and launches viewer", async () => {
		let capturedCmd = "";
		let capturedArgs: string[] = [];
		const customSpawn = vi.fn((cmd: string, args: string[]) => {
			capturedCmd = cmd;
			capturedArgs = args;
			return {
				on: vi.fn(),
				unref: vi.fn(),
			};
		});

		const previewer = new MediaPreviewer({
			spawnFn: customSpawn as any,
		});

		const buffer = Buffer.from("dummy pdf content");
		const result = await previewer.previewMedia(buffer, "application/pdf", "weekly_menu.pdf");

		expect(result.success).toBe(true);
		expect(result.filePath).toBeDefined();
		expect(result.filePath?.endsWith(".pdf")).toBe(true);
		expect(fs.existsSync(result.filePath!)).toBe(true);
		expect(customSpawn).toHaveBeenCalled();

		// Clean up created temp file
		if (result.filePath && fs.existsSync(result.filePath)) {
			fs.unlinkSync(result.filePath);
		}
	});

	it("falls back to mimeType extension mapping when filename has no extension", async () => {
		const customSpawn = vi.fn(() => ({
			on: vi.fn(),
			unref: vi.fn(),
		}));

		const previewer = new MediaPreviewer({
			spawnFn: customSpawn as any,
		});

		const buffer = Buffer.from("dummy image bytes");
		const result = await previewer.previewMedia(buffer, "image/jpeg");

		expect(result.success).toBe(true);
		expect(result.filePath?.endsWith(".jpg")).toBe(true);

		if (result.filePath && fs.existsSync(result.filePath)) {
			fs.unlinkSync(result.filePath);
		}
	});

	it("handles spawn failure gracefully without throwing", async () => {
		const customSpawn = vi.fn(() => {
			throw new Error("spawn ENOENT");
		});

		const previewer = new MediaPreviewer({
			spawnFn: customSpawn as any,
		});

		const buffer = Buffer.from("test");
		const result = await previewer.previewMedia(buffer, "application/pdf");

		expect(result.success).toBe(false);
		expect(result.error).toContain("spawn ENOENT");
		expect(result.filePath).toBeDefined();

		if (result.filePath && fs.existsSync(result.filePath)) {
			fs.unlinkSync(result.filePath);
		}
	});
});
