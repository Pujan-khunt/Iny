import type { ExecFileOptions } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import type {
	PdfInspection,
	PdfPageRender,
	PdfRasterizationPort,
} from "../../../../core/ports/PdfRasterizationPort";
/** Injected Poppler execution with bounded duration, output, and invocation cancellation. */
export type CommandRunner = (
	file: string,
	args: readonly string[],
	options: ExecFileOptions & { timeout: number; signal?: AbortSignal },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
const BYTE_LIMIT = 32 * 1024 * 1024;
const PIXEL_LIMIT = 50_000_000;
/** Inspects and renders complete first PDF pages with native Poppler resource limits. */
export class PdfRasterizer implements PdfRasterizationPort {
	/** @param runner Native command executor honoring timeout and abort options. */
	constructor(private readonly runner: CommandRunner) {}
	/** @param pdf Original bytes. @param signal Invocation cancellation. @returns Total pages and full first-page geometry. @throws On invalid input, limits, timeout, or cancellation. */
	async inspect(pdf: Uint8Array, signal?: AbortSignal): Promise<PdfInspection> {
		return this.withPdf(pdf, signal, (pdfPath) => this.inspectPath(pdfPath, signal));
	}
	/** @param pdf Original bytes. @param dpi Positive finite DPI, default 600. @param signal Invocation cancellation. @returns Bounded PNG and measured metadata. @throws On invalid input/output, limits, timeout, or cancellation. */
	async renderFirstPage(pdf: Uint8Array, dpi = 600, signal?: AbortSignal): Promise<PdfPageRender> {
		if (!Number.isFinite(dpi) || dpi <= 0) throw new Error("Invalid PDF render DPI");
		const started = performance.now();
		return this.withPdf(pdf, signal, async (pdfPath) => {
			const inspection = await this.inspectPath(pdfPath, signal);
			// pdfinfo rounds both MediaBox endpoints to 0.01 points, so each extent has ±0.01 uncertainty.
			const ranges = [inspection.widthPoints, inspection.heightPoints].map((points) =>
				[-0.01, 0.01].map((delta) => Math.max(1, Math.ceil(((points + delta) * dpi) / 72))),
			);
			this.checkPixels(ranges[0][1], ranges[1][1]);
			const prefix = path.join(path.dirname(pdfPath), "page");
			await this.run(
				"pdftoppm",
				["-png", "-r", String(dpi), "-f", "1", "-l", "1", "-singlefile", pdfPath, prefix],
				signal,
			);
			const pngPath = `${prefix}.png`;
			if ((await fs.stat(pngPath)).size > BYTE_LIMIT) throw new Error("PNG byte limit exceeded");
			const pngBytes = await fs.readFile(pngPath, { signal });
			const [widthPixels, heightPixels] = this.readPng(pngBytes);
			const pixels = [widthPixels, heightPixels];
			if (pixels.some((value, axis) => value < ranges[axis][0] || value > ranges[axis][1]))
				throw new Error("PNG geometry mismatch");
			return { pngBytes, widthPixels, heightPixels, dpi, elapsedMs: performance.now() - started };
		});
	}
	private async withPdf<T>(
		pdf: Uint8Array,
		signal: AbortSignal | undefined,
		operation: (pdfPath: string) => Promise<T>,
	): Promise<T> {
		signal?.throwIfAborted();
		if (pdf.length > BYTE_LIMIT || Buffer.from(pdf.subarray(0, 5)).toString() !== "%PDF-") {
			throw new Error("Invalid PDF input or byte limit exceeded");
		}
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "iny-pdf-"));
		try {
			const pdfPath = path.join(directory, "input.pdf");
			await fs.writeFile(pdfPath, pdf, { signal });
			return await operation(pdfPath);
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	}
	private async run(file: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
		signal?.throwIfAborted();
		try {
			const result = await this.runner(file, args, {
				timeout: 30_000,
				signal,
				maxBuffer: 64 * 1024,
				killSignal: "SIGKILL",
				env: { ...process.env, LC_ALL: "C" },
			});
			signal?.throwIfAborted();
			return result.stdout.toString();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new Error(`${file} binary not found; install poppler-utils`);
			throw error;
		}
	}
	private async inspectPath(pdfPath: string, signal?: AbortSignal): Promise<PdfInspection> {
		const output = await this.run("pdfinfo", ["-f", "1", "-l", "1", "-box", pdfPath], signal);
		const field = (pattern: RegExp) => pattern.exec(output)?.[1] ?? "";
		const pageCount = Number.parseInt(field(/^Pages:\s+(\d+)\s*$/m), 10);
		const box = field(/^Page\s+1 MediaBox:\s+(.+)$/m)
			.trim()
			.split(/\s+/)
			.map(Number);
		const rotation = Number.parseInt(field(/^Page\s+1 rot:\s+(-?\d+)\s*$/m), 10);
		if (
			!Number.isSafeInteger(pageCount) ||
			pageCount < 1 ||
			box.length !== 4 ||
			!box.every(Number.isFinite) ||
			!Number.isFinite(rotation) ||
			rotation % 90 !== 0
		) {
			throw new Error("Invalid PDF inspection metadata");
		}
		const width = box[2] - box[0];
		const height = box[3] - box[1];
		if (width <= 0 || height <= 0) throw new Error("Invalid PDF geometry");
		const [widthPoints, heightPoints] = rotation % 180 ? [height, width] : [width, height];
		return { pageCount, widthPoints, heightPoints };
	}
	private checkPixels(width: number, height: number): void {
		if (
			![width, height].every((value) => Number.isSafeInteger(value) && value > 0) ||
			width * height > PIXEL_LIMIT
		) {
			throw new Error("PDF/PNG pixel limit exceeded");
		}
	}
	private readPng(png: Buffer): readonly [number, number] {
		if (png.length > BYTE_LIMIT) throw new Error("PNG byte limit exceeded");
		if (
			png.length < 45 ||
			png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
			png.readUInt32BE(8) !== 13 ||
			png.toString("ascii", 12, 16) !== "IHDR"
		) {
			throw new Error("Invalid PNG metadata");
		}
		if (
			crc32(png.subarray(12, 29)) !== png.readUInt32BE(29) ||
			png.subarray(-12).toString("hex") !== "0000000049454e44ae426082"
		)
			throw new Error("Invalid PNG metadata");
		this.checkPngFormat(png);
		const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
		this.checkPixels(width, height);
		return [width, height];
	}
	private checkPngFormat(png: Buffer): void {
		const depths = [[1, 2, 4, 8, 16], [], [8, 16], [1, 2, 4, 8], [8, 16], [], [8, 16]];
		if (!depths[png[25]]?.includes(png[24]) || png[26] !== 0 || png[27] !== 0 || png[28] > 1)
			throw new Error("Invalid PNG metadata");
	}
}
