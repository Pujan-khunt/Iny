import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface MediaPreviewResult {
	success: boolean;
	filePath?: string;
	error?: string;
}

export interface MediaPreviewerOptions {
	spawnFn?: (command: string, args: string[], options: any) => ChildProcess;
	openerCommand?: string;
}

export class MediaPreviewer {
	constructor(private readonly options?: MediaPreviewerOptions) {}

	/**
	 * Resolves the default media viewer command based on current operating system.
	 */
	resolveOpener(): string {
		if (this.options?.openerCommand) {
			return this.options.openerCommand;
		}
		switch (process.platform) {
			case "darwin":
				return "open";
			case "win32":
				return "start";
			default:
				return "xdg-open";
		}
	}

	/**
	 * Resolves the appropriate file extension from filename or MIME type.
	 */
	resolveExtension(mimeType: string, filename?: string): string {
		if (filename) {
			const ext = path.extname(filename);
			if (ext && ext.length > 1) {
				return ext.toLowerCase();
			}
		}

		const normalizedMime = mimeType.toLowerCase().trim();
		switch (normalizedMime) {
			case "application/pdf":
				return ".pdf";
			case "image/jpeg":
			case "image/jpg":
				return ".jpg";
			case "image/png":
				return ".png";
			case "image/webp":
				return ".webp";
			case "text/plain":
				return ".txt";
			case "application/json":
				return ".json";
			default:
				return ".bin";
		}
	}

	/**
	 * Writes the binary media buffer to a temporary file with the appropriate extension
	 * and launches the operating system's native viewer (e.g. Evince, Preview, xdg-open).
	 * Gracefully catches and returns errors if running headless or no viewer is available.
	 */
	async previewMedia(
		buffer: Buffer,
		mimeType: string,
		filename?: string,
	): Promise<MediaPreviewResult> {
		const ext = this.resolveExtension(mimeType, filename);
		const tempFileName = `iny_preview_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
		const filePath = path.join(os.tmpdir(), tempFileName);

		try {
			await fs.promises.writeFile(filePath, buffer);

			const opener = this.resolveOpener();
			const spawnFn = this.options?.spawnFn ?? spawn;

			return await new Promise<MediaPreviewResult>((resolve) => {
				try {
					const child = spawnFn(opener, [filePath], {
						detached: true,
						stdio: "ignore",
					});

					// In case spawn throws or errors synchronously
					child.on?.("error", (err: Error) => {
						resolve({
							success: false,
							filePath,
							error: err.message,
						});
					});

					// Detach so child process outlives parent node execution without blocking
					child.unref?.();

					resolve({
						success: true,
						filePath,
					});
				} catch (spawnErr: any) {
					resolve({
						success: false,
						filePath,
						error: spawnErr.message,
					});
				}
			});
		} catch (writeErr: any) {
			return {
				success: false,
				filePath,
				error: `Failed to write media to temp file: ${writeErr.message}`,
			};
		}
	}
}
