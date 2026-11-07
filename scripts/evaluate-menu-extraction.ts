import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import OpenAI from "openai";
import { PdfRasterizer } from "../src/adapters/outbound/mess/extraction/PdfRasterizer";
import { DeepseekVisionExtractor } from "../src/adapters/outbound/mess/extraction/DeepseekVisionExtractor";
import { MenuDishNormalizer } from "../src/core/services/MenuDishNormalizer";

import {
	readManifest,
	validateFiles,
	mismatches,
	type EvaluationCase,
} from "./MenuExtractionEvaluationSupport";

const execute = promisify(execFile);
const unavailable = { value: null, reason: "Not measured" };

function argumentsForRun() {
	const args = process.argv.slice(2);
	if (args.length !== 4 || args[0] !== "--manifest" || args[2] !== "--out")
		throw new Error(
			"Usage: tsx scripts/evaluate-menu-extraction.ts --manifest <absolute-path> --out <absolute-path>",
		);
	if (!path.isAbsolute(args[1]) || !path.isAbsolute(args[3]))
		throw new Error("Paths must be absolute");
	return { manifestPath: args[1], out: args[3] };
}
function emptyRecord(id: string, dpi: number) {
	const record: Record<string, unknown> = {
		id,
		dpi,
		failure: null,
		raw: null,
		canonical: null,
	};
	for (const field of [
		"dimensions",
		"bytes",
		"renderDurationMs",
		"modelLatencyMs",
		"rawFieldMismatches",
		"canonicalFieldMismatches",
	])
		record[field] = unavailable;
	return record;
}
async function evaluate(entry: EvaluationCase, dpi: number, extractor: DeepseekVisionExtractor) {
	const rasterizer = new PdfRasterizer((file, args, options) => execute(file, [...args], options));
	const record = emptyRecord(entry.id, dpi);
	let phase = "render";
	let modelStarted: number | undefined;
	try {
		const rendered = await rasterizer.renderFirstPage(await fs.readFile(entry.pdfPath), dpi);
		Object.assign(record, {
			dimensions: [rendered.widthPixels, rendered.heightPixels],
			bytes: rendered.pngBytes.length,
			renderDurationMs: rendered.elapsedMs,
		});
		phase = "model";
		modelStarted = performance.now();
		const result = await extractor.extractWeeklyMenu(rendered.pngBytes, { mimeType: "image/png" });
		Object.assign(record, {
			raw: result.rawMenu,
			canonical: result.menu,
			corrections: result.corrections,
			rawFieldMismatches: mismatches(entry.expected, result.rawMenu),
			canonicalFieldMismatches: mismatches(
				MenuDishNormalizer.normalize(entry.expected).menu,
				result.menu,
			),
		});
	} catch (error) {
		record.failure = {
			phase,
			message: error instanceof Error ? error.message : String(error),
			rawResponse: (error as { rawResponse?: string }).rawResponse ?? null,
		};
	}
	if (modelStarted !== undefined) record.modelLatencyMs = performance.now() - modelStarted;
	record.peakRendererMemoryKiB = {
		value: null,
		reason: "Bounded renderer does not expose per-child peak RSS; no memory measurement taken",
	};
	return record;
}
async function main() {
	const { manifestPath, out } = argumentsForRun();
	const manifest = await readManifest(manifestPath);
	await validateFiles(manifest.cases, manifestPath, out);
	const apiKey = process.env.MENU_EVAL_API_KEY;
	const baseURL = process.env.MENU_EVAL_BASE_URL;
	if (!apiKey || !baseURL)
		throw new Error(
			"Set explicit MENU_EVAL_API_KEY and MENU_EVAL_BASE_URL for a deliberate live evaluation",
		);
	const settings = {
		model: manifest.model,
		baseURL,
		timeout: 120_000,
		maxRetries: 0,
		response_format: { type: "json_object" },
		sampling: "provider defaults; no override",
	};
	await fs.writeFile(out, "", { flag: "wx" });
	const extractor = new DeepseekVisionExtractor(
		new OpenAI({ apiKey, baseURL, timeout: settings.timeout, maxRetries: settings.maxRetries }),
		manifest.model,
	);
	const results = [];
	for (const entry of manifest.cases) {
		for (const dpi of [300, 600]) results.push(await evaluate(entry, dpi, extractor));
	}
	const memoryMethod = "Unavailable: bounded renderer does not expose per-child peak RSS";
	const report = { corpusSize: manifest.cases.length, settings, memoryMethod, results };
	await fs.writeFile(out, JSON.stringify(report, null, 2));
}
main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
