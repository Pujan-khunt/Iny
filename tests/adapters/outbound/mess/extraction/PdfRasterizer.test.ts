import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { crc32, deflateSync } from "node:zlib";
import {
	PdfRasterizer,
	type CommandRunner,
} from "../../../../../src/adapters/outbound/mess/extraction/PdfRasterizer";

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

const info = (pages = 1, box = "0 0 72 36", rotation = 0) =>
	`Pages: ${pages}\nPage    1 size: 36 x 18 pts\nPage    1 rot: ${rotation}\nPage    1 MediaBox: ${box}\nPage    1 CropBox: 0 0 36 18\n`;
function chunk(type: string, bytes: Buffer): Buffer {
	const name = Buffer.from(type);
	const result = Buffer.alloc(bytes.length + 12);
	result.writeUInt32BE(bytes.length);
	name.copy(result, 4);
	bytes.copy(result, 8);
	result.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8);
	return result;
}
function png(width = 600, height = 300): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 0;
	return Buffer.concat([
		Buffer.from("89504e470d0a1a0a", "hex"),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * height))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
function fake(options: { info?: string; output?: Buffer; fail?: string; hang?: string } = {}) {
	const calls: {
		command: string;
		args: readonly string[];
		options: Parameters<CommandRunner>[2];
	}[] = [];
	const runner: CommandRunner = async (command, args, commandOptions) => {
		calls.push({ command, args, options: commandOptions });
		if (options.fail === command)
			throw Object.assign(new Error("missing binary"), { code: "ENOENT" });
		if (options.hang === command)
			return new Promise((_, reject) => {
				const abort = () => reject(new Error("command cancelled"));
				commandOptions.signal?.addEventListener("abort", abort, { once: true });
				setTimeout(() => reject(new Error("command timed out")), commandOptions.timeout).unref();
			});
		if (command === "pdfinfo") return { stdout: options.info ?? info(), stderr: "" };
		await fs.writeFile(`${args.at(-1)}.png`, options.output ?? png());
		return { stdout: "", stderr: "" };
	};
	return { calls, rasterizer: new PdfRasterizer(runner) };
}
async function cleaned(calls: ReturnType<typeof fake>["calls"]): Promise<void> {
	for (const call of calls) {
		const pdfPath = call.command === "pdfinfo" ? call.args.at(-1)! : call.args.at(-2)!;
		await expect(fs.stat(path.dirname(pdfPath))).rejects.toMatchObject({ code: "ENOENT" });
	}
}
afterEach(() => vi.useRealTimers());

describe("PdfRasterizer", () => {
	it("renders the complete first page at 600 DPI after inspection and cleans all files", async () => {
		const { rasterizer, calls } = fake();
		const result = await rasterizer.renderFirstPage(minimalValidPdf);
		expect(result).toMatchObject({ widthPixels: 600, heightPixels: 300, dpi: 600 });
		expect(result.pngBytes).toEqual(png());
		expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
		expect(calls.map((c) => c.command)).toEqual(["pdfinfo", "pdftoppm"]);
		expect(calls[0].args).toEqual(["-f", "1", "-l", "1", "-box", expect.any(String)]);
		expect(calls[1].args.slice(0, -2)).toEqual([
			"-png",
			"-r",
			"600",
			"-f",
			"1",
			"-l",
			"1",
			"-singlefile",
		]);
		expect(calls.every((c) => c.options.timeout === 30_000)).toBe(true);
		await cleaned(calls);
	});
	it("preserves an explicit 150 DPI override", async () => {
		const { rasterizer, calls } = fake({ output: png(150, 75) });
		expect(await rasterizer.renderFirstPage(minimalValidPdf, 150)).toMatchObject({
			dpi: 150,
			widthPixels: 150,
			heightPixels: 75,
		});
		expect(calls[1].args).toContain("150");
		await cleaned(calls);
	});
	it("reports true total pages and first-page full dimensions including rotation", async () => {
		const { rasterizer, calls } = fake({ info: info(2, "10 20 82 56", 90), output: png(300, 600) });
		expect(await rasterizer.inspect(minimalValidPdf)).toEqual({
			pageCount: 2,
			widthPoints: 36,
			heightPoints: 72,
		});
		expect(await rasterizer.renderFirstPage(minimalValidPdf)).toMatchObject({
			widthPixels: 300,
			heightPixels: 600,
		});
		await cleaned(calls);
	});
	it.each([0, -1, NaN, Infinity, -Infinity])(
		"rejects invalid DPI %s before commands",
		async (dpi) => {
			const { rasterizer, calls } = fake();
			await expect(rasterizer.renderFirstPage(minimalValidPdf, dpi)).rejects.toThrow(/dpi/i);
			expect(calls).toEqual([]);
		},
	);
	it.each([
		Buffer.alloc(0),
		Buffer.from("corrupt_non_pdf_data"),
		Buffer.alloc(32 * 1024 * 1024 + 1),
	])("rejects invalid or oversized input before commands", async (pdf) => {
		const { rasterizer, calls } = fake();
		await expect(rasterizer.inspect(pdf)).rejects.toThrow(/pdf|limit/i);
		expect(calls).toEqual([]);
	});
	it.each(["Pages: 0", info(1, "0 0 0 72"), info(1, "0 0 NaN 72"), info(1, "0 0 72 36", 45)])(
		"rejects malformed inspection metadata and cleans files",
		async (metadata) => {
			const { rasterizer, calls } = fake({ info: metadata });
			await expect(rasterizer.inspect(minimalValidPdf)).rejects.toThrow(/metadata|geometry/i);
			await cleaned(calls);
		},
	);
	it.each(["pdfinfo", "pdftoppm"])("reports missing %s and cleans files", async (fail) => {
		const { rasterizer, calls } = fake({ fail });
		await expect(rasterizer.renderFirstPage(minimalValidPdf)).rejects.toThrow(/binary|poppler/i);
		await cleaned(calls);
	});
	it("rejects excessive expected pixels before rendering", async () => {
		const { rasterizer, calls } = fake({ info: info(1, "0 0 1000 1000") });
		await expect(rasterizer.renderFirstPage(minimalValidPdf)).rejects.toThrow(/pixel|limit/i);
		expect(calls.map((c) => c.command)).toEqual(["pdfinfo"]);
		await cleaned(calls);
	});
	it.each([Buffer.alloc(32 * 1024 * 1024 + 1), Buffer.from("not a png"), png(150, 75)])(
		"rejects oversized, invalid, or mismatched output and cleans files",
		async (output) => {
			const { rasterizer, calls } = fake({ output });
			await expect(rasterizer.renderFirstPage(minimalValidPdf)).rejects.toThrow(
				/png|pixel|geometry|limit/i,
			);
			await cleaned(calls);
		},
	);
	it.each([24, 25, 26, 27, 28, 29])("rejects malformed PNG header byte %s", async (offset) => {
		const output = png();
		output[offset] = 255;
		if (offset !== 29) output.writeUInt32BE(crc32(output.subarray(12, 29)), 29);
		const { rasterizer, calls } = fake({ output });
		await expect(rasterizer.renderFirstPage(minimalValidPdf)).rejects.toThrow(/png/i);
		await cleaned(calls);
	});
	it("rejects excessive measured pixel dimensions", async () => {
		const output = png();
		output.writeUInt32BE(100_000, 16);
		output.writeUInt32BE(100_000, 20);
		output.writeUInt32BE(crc32(output.subarray(12, 29)), 29);
		const { rasterizer, calls } = fake({ output });
		await expect(rasterizer.renderFirstPage(minimalValidPdf)).rejects.toThrow(/pixel|limit/i);
		await cleaned(calls);
	});
	it("propagates invocation cancellation to commands and cleans files", async () => {
		const controller = new AbortController();
		const { rasterizer, calls } = fake({ hang: "pdftoppm" });
		const result = rasterizer.renderFirstPage(minimalValidPdf, undefined, controller.signal);
		const assertion = expect(result).rejects.toThrow(/cancel|abort/i);
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		controller.abort();
		await assertion;
		expect(calls[1].options.signal?.aborted).toBe(true);
		await cleaned(calls);
	});
	it("does not start an already cancelled invocation", async () => {
		const controller = new AbortController();
		controller.abort();
		const { rasterizer, calls } = fake();
		await expect(rasterizer.inspect(minimalValidPdf, controller.signal)).rejects.toThrow(/abort/i);
		expect(calls).toEqual([]);
	});
	it.each(["pdfinfo", "pdftoppm"])(
		"applies a 30-second %s deadline and cleans files",
		async (hang) => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			const { rasterizer, calls } = fake({ hang });
			const result = rasterizer.renderFirstPage(minimalValidPdf);
			const assertion = expect(result).rejects.toThrow(/timed out/i);
			await vi.waitFor(() => expect(calls.at(-1)?.command).toBe(hang));
			await vi.advanceTimersByTimeAsync(30_000);
			await assertion;
			await cleaned(calls);
		},
	);
	it.each([
		{ box: "0 0 72.001 36", dpi: 600, rotation: 0, width: 601, height: 300 },
		{ box: "-0.0049 -0.0049 0.0149 0.0149", dpi: 720_000, rotation: 0, width: 199, height: 199 },
		{ box: "0.0049 0.0049 0.0151 0.0151", dpi: 720_000, rotation: 0, width: 103, height: 103 },
		{ box: "-10.004 -20.004 61.999 15.999", dpi: 600, rotation: 0, width: 601, height: 301 },
		{ box: "-10.004 -20.004 61.999 15.999", dpi: 150, rotation: 90, width: 76, height: 151 },
	])(
		"renders fractional full-page geometry with real Poppler: $box at $dpi DPI rotation $rotation",
		async ({ box, dpi, rotation, width, height }) => {
			const pdf = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [${box}] /Rotate ${rotation} >> endobj
trailer << /Size 4 /Root 1 0 R >>
%%EOF`);
			const calls: ReturnType<typeof fake>["calls"] = [];
			const rasterizer = new PdfRasterizer(async (command, args, options) => {
				calls.push({ command, args, options });
				const result = await promisify(execFile)(command, args, options);
				if (command === "pdfinfo")
					console.log(
						result.stdout
							.toString()
							.split("\n")
							.filter((line) => /MediaBox/.test(line))
							.join("\n"),
					);
				if (command === "pdftoppm") {
					const bytes = await fs.readFile(`${args.at(-1)}.png`);
					console.log(`native PNG ${bytes.readUInt32BE(16)} x ${bytes.readUInt32BE(20)}`);
				}
				return result;
			});
			await expect(rasterizer.renderFirstPage(pdf, dpi)).resolves.toMatchObject({
				widthPixels: width,
				heightPixels: height,
				dpi,
			});
			await cleaned(calls);
		},
	);
	it("bounds both rounded endpoints before rendering near the pixel limit", async () => {
		// At 720000 DPI, printed 0.01 x 30 points predicts 100 x 300000 pixels.
		// Two rounded endpoints allow 200 x 300100, exceeding 50 million;
		// allowing only one endpoint would predict 150 x 300050, incorrectly below the cap.
		const { rasterizer, calls } = fake({ info: info(1, "-10.00 -20.00 -9.99 10.00") });
		await expect(rasterizer.renderFirstPage(minimalValidPdf, 720_000)).rejects.toThrow(
			/pixel|limit/i,
		);
		expect(calls.map((c) => c.command)).toEqual(["pdfinfo"]);
		await cleaned(calls);
	});
	it("uses full MediaBox, rotation and total page count with real Poppler", async () => {
		const pdf = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 72 36] /CropBox [0 0 36 18] /Rotate 90 >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 720 720] >> endobj
trailer << /Size 5 /Root 1 0 R >>
%%EOF`);
		const rasterizer = new PdfRasterizer(promisify(execFile));
		expect(await rasterizer.inspect(pdf)).toEqual({
			pageCount: 2,
			widthPoints: 36,
			heightPoints: 72,
		});
		expect(await rasterizer.renderFirstPage(pdf)).toMatchObject({
			widthPixels: 300,
			heightPixels: 600,
		});
	});
	it("renders a real synthetic PDF with Poppler and measures actual PNG dimensions", async () => {
		const rasterizer = new PdfRasterizer(promisify(execFile));
		expect(await rasterizer.inspect(minimalValidPdf)).toEqual({
			pageCount: 1,
			widthPoints: 100,
			heightPoints: 100,
		});
		const result = await rasterizer.renderFirstPage(minimalValidPdf, 150);
		expect(result).toMatchObject({ widthPixels: 209, heightPixels: 209, dpi: 150 });
		expect(Buffer.from(result.pngBytes).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		await expect(rasterizer.inspect(Buffer.from("%PDF corrupt"))).rejects.toThrow();
	});
});
