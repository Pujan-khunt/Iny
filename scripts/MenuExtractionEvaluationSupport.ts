import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ExtractedWeeklyMenuSchema } from "../src/adapters/common/mess/ExtractionSchemas";
import type { StagedWeeklyMenu } from "../src/core/entities/MessAnnouncement";

const caseSchema = z.strictObject({
	id: z.string().trim().min(1),
	pdfPath: z.string(),
	expected: ExtractedWeeklyMenuSchema.strict(),
});
const manifestSchema = z.strictObject({
	model: z.string().trim().min(1),
	cases: z.array(caseSchema).min(1),
});
/** One validated local PDF and manually checked raw weekly menu. */
export type EvaluationCase = z.infer<typeof manifestSchema>["cases"][number];
/**
 * Reads and validates the explicit manifest schema.
 * @param manifestPath Absolute local JSON path supplied by the entrypoint.
 * @returns Parsed raw expectations. @throws On unreadable files, JSON, or schema errors.
 */
export async function readManifest(manifestPath: string) {
	return manifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, "utf8")));
}
function validateWeek(menu: StagedWeeklyMenu) {
	const dates = [...new Set(menu.meals.map((meal) => meal.mealDate))].sort();
	const keys = new Set(menu.meals.map((meal) => `${meal.mealDate}/${meal.mealSlot}`));
	const valid = dates.every((date, index) => {
		const instant = new Date(`${date}T00:00:00Z`);
		return (
			Number.isFinite(+instant) &&
			instant.toISOString().slice(0, 10) === date &&
			+instant === +new Date(`${dates[0]}T00:00:00Z`) + index * 86_400_000
		);
	});
	if (dates.length !== 7 || keys.size !== 21 || !valid)
		throw new Error("Expected all 21 unique slots over seven consecutive valid dates");
	if (menu.meals.some((meal) => meal.items.some((item) => !item.trim())))
		throw new Error("Blank expected item");
}
/**
 * Validates all expectations and paths without modifying any file.
 * @param cases Parsed manually labeled PDFs. @param manifestPath Original manifest path.
 * @param out Absolute new output path. @throws On invalid expectations, files, or output.
 */
export async function validateFiles(cases: EvaluationCase[], manifestPath: string, out: string) {
	if (new Set(cases.map((entry) => entry.id)).size !== cases.length)
		throw new Error("Duplicate case id");
	const outputPath = path.join(await fs.realpath(path.dirname(out)), path.basename(out));
	const protectedPaths = [await fs.realpath(manifestPath)];
	for (const entry of cases) {
		validateWeek(entry.expected);
		if (!path.isAbsolute(entry.pdfPath)) throw new Error("PDF paths must be absolute");
		protectedPaths.push(await fs.realpath(entry.pdfPath));
		const stat = await fs.stat(entry.pdfPath);
		if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error("Invalid PDF file or size");
		const bytes = await fs.readFile(entry.pdfPath);
		if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid PDF signature");
	}
	if (protectedPaths.includes(outputPath)) throw new Error("Output would overwrite an input");
	await fs.access(path.dirname(out), fs.constants.W_OK);
	await fs.lstat(out).then(
		() => {
			throw new Error("Output must be a new file");
		},
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		},
	);
}
/**
 * Compares vendor and date/slot/item fields exactly, including duplicate slot occurrences.
 * @param expected Manually checked labels. @param actual Extracted raw or canonical menu.
 * @returns Missing, unexpected, and changed fields with both values; performs no I/O.
 */
export function mismatches(expected: StagedWeeklyMenu, actual: StagedWeeklyMenu) {
	const fields = (menu: StagedWeeklyMenu): [string, string][] => {
		const occurrences = new Map<string, number>();
		return [
			["vendor", menu.vendor],
			...menu.meals.flatMap((meal) => {
				const key = JSON.stringify([meal.mealDate, meal.mealSlot]);
				const occurrence = occurrences.get(key) ?? 0;
				occurrences.set(key, occurrence + 1);
				return meal.items.map((item, index): [string, string] => [
					JSON.stringify([meal.mealDate, meal.mealSlot, occurrence, "items", index]),
					item,
				]);
			}),
		];
	};
	const before = new Map(fields(expected));
	const after = new Map(fields(actual));
	return [...new Set([...before.keys(), ...after.keys()])].flatMap((field) =>
		before.get(field) === after.get(field)
			? []
			: [{ field, expected: before.get(field) ?? null, actual: after.get(field) ?? null }],
	);
}
