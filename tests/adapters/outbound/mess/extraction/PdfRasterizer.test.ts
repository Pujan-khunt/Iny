import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import { PdfRasterizer } from "../../../../../src/adapters/outbound/mess/extraction/PdfRasterizer";

const minimalValidPdf = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >> endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer << /Size 4 /Root 1 0 R >>
startxref
190
%%EOF`);

// Standard PNG magic signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A (\x89PNG\r\n\x1a\n)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("PdfRasterizer", () => {
	it("rasterizes a valid PDF buffer to PNG using pdftoppm (static and instance)", async () => {
		const pngBuffer = await PdfRasterizer.rasterizePageOneToPng(minimalValidPdf, 150);
		expect(Buffer.isBuffer(pngBuffer)).toBe(true);
		expect(pngBuffer.length).toBeGreaterThan(0);
		expect(pngBuffer.subarray(0, 4)).toEqual(PNG_MAGIC);

		const instance = new PdfRasterizer();
		const pngBuffer2 = await instance.rasterizePageOneToPng(minimalValidPdf, 150);
		expect(pngBuffer2.subarray(0, 4)).toEqual(PNG_MAGIC);
	});

	it("cleans up temporary files in finally block after successful execution", async () => {
		const unlinkSpy = vi.spyOn(fs.promises, "unlink");
		await PdfRasterizer.rasterizePageOneToPng(minimalValidPdf, 150);

		expect(unlinkSpy).toHaveBeenCalled();
		const unlinkedPaths = unlinkSpy.mock.calls.map((call) => call[0] as string);
		// Should have unlinked the temp pdf and the temp png
		expect(unlinkedPaths.some((p) => p.endsWith(".pdf"))).toBe(true);
		expect(unlinkedPaths.some((p) => p.endsWith(".png"))).toBe(true);
		unlinkSpy.mockRestore();
	});

	it("rejects an empty buffer", async () => {
		await expect(PdfRasterizer.rasterizePageOneToPng(Buffer.alloc(0))).rejects.toThrow(
			/empty|invalid/i,
		);
	});

	it("rejects corrupt buffer and cleans up temp files on error", async () => {
		const unlinkSpy = vi.spyOn(fs.promises, "unlink");
		const corruptBuffer = Buffer.from("corrupt_non_pdf_data");

		await expect(PdfRasterizer.rasterizePageOneToPng(corruptBuffer)).rejects.toThrow();

		expect(unlinkSpy).toHaveBeenCalled();
		unlinkSpy.mockRestore();
	});

	it("throws descriptive error when pdftoppm binary is missing (ENOENT)", async () => {
		const enoentError = Object.assign(new Error("spawn pdftoppm ENOENT"), { code: "ENOENT" });
		const mockRunner = vi.fn().mockRejectedValue(enoentError);

		await expect(
			PdfRasterizer.rasterizePageOneToPng(minimalValidPdf, 150, mockRunner),
		).rejects.toThrow(
			'pdftoppm binary not found. Please ensure "poppler-utils" is installed on your system.',
		);
	});
});
