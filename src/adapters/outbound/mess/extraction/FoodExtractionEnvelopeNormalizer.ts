import { supplementLocationEvidence } from "./LocationEvidenceSupplementer";

interface MenuCandidate {
	dateRange?: { start?: string; end?: string };
	menu?: { vendor?: string };
}

function resolveSpan(rec: Record<string, unknown>, loc: Record<string, unknown>, text: string) {
	if (typeof rec.clause !== "string") return null;
	const cStart = text.indexOf(rec.clause),
		rIdx = rec.clause.indexOf(rec.rawValue as string);
	if (cStart < 0 || rIdx < 0) return null;
	const start = cStart + rIdx,
		end = start + (rec.rawValue as string).length;
	return loc.start === start && loc.end === end
		? rec
		: { ...rec, location: { ...loc, start, end } };
}

function anchorValue(path: string, cand: MenuCandidate): string | undefined {
	const map: Record<string, string | undefined> = {
		"/dateRange/start": cand.dateRange?.start,
		"/dateRange/end": cand.dateRange?.end,
		"/menu/vendor": cand.menu?.vendor,
	};
	return map[path];
}

function fallbackValue(path: unknown, candidate?: unknown): string | null {
	if (typeof path !== "string" || !candidate) return null;
	return anchorValue(path, candidate as MenuCandidate) ?? null;
}

function normalizeFieldPath(rec: Record<string, unknown>): Record<string, unknown> {
	if (!("path" in rec)) return rec;
	const { path, ...rest } = rec;
	return typeof rest.fieldPath === "string" ? rest : { ...rest, fieldPath: path };
}

function normalizeValues(
	rec: Record<string, unknown>,
	candidate?: unknown,
): Record<string, unknown> {
	const raw =
		typeof rec.rawValue === "string" && rec.rawValue.trim()
			? rec.rawValue
			: fallbackValue(rec.fieldPath, candidate);
	if (!raw) return rec;
	const clause = typeof rec.clause === "string" && rec.clause.trim() ? rec.clause : raw;
	return raw === rec.rawValue && clause === rec.clause ? rec : { ...rec, rawValue: raw, clause };
}

function alignTextSpan(
	record: Record<string, unknown>,
	textBody?: string | null,
): Record<string, unknown> {
	const loc = record.location as Record<string, unknown> | undefined;
	if (loc?.kind !== "text" || typeof record.rawValue !== "string" || !Number.isInteger(loc.start))
		return record;
	if (textBody) {
		const resolved = resolveSpan(record, loc, textBody);
		if (resolved) return resolved;
	}
	const expectedEnd = (loc.start as number) + record.rawValue.length;
	return loc.end === expectedEnd ? record : { ...record, location: { ...loc, end: expectedEnd } };
}

function normalizeEvidenceEntry(
	entry: unknown,
	textBody?: string | null,
	candidate?: unknown,
): unknown {
	if (!entry || typeof entry !== "object") return entry;
	const withPath = normalizeFieldPath(entry as Record<string, unknown>);
	const withValues = normalizeValues(withPath, candidate);
	return alignTextSpan(withValues, textBody);
}

function normalizeEvidenceList(
	evidence: unknown[],
	textBody?: string | null,
	candidate?: unknown,
): unknown[] {
	let modified = false;
	const normalized = evidence.map((item) => {
		const next = normalizeEvidenceEntry(item, textBody, candidate);
		if (next !== item) modified = true;
		return next;
	});
	return modified ? normalized : evidence;
}

function wrapFlattenedCandidate(
	record: Record<string, unknown>,
	textBody?: string | null,
): unknown {
	const flattened =
		(record.kind === "operational_announcement" && record.announcement) ||
		(record.kind === "weekly_menu" && record.menu);
	if (!flattened) return null;
	const { evidence, ...candidate } = record;
	const rawEvidence = Array.isArray(evidence)
		? normalizeEvidenceList(evidence, textBody, candidate)
		: [];
	return {
		kind: "candidate",
		candidate,
		evidence: supplementLocationEvidence(candidate, rawEvidence),
	};
}

function normalizeCandidateEnvelope(
	raw: unknown,
	record: Record<string, unknown>,
	textBody?: string | null,
): unknown {
	if (record.kind !== "candidate" || !Array.isArray(record.evidence)) return raw;
	const supplemented = supplementLocationEvidence(
		record.candidate,
		normalizeEvidenceList(record.evidence, textBody, record.candidate),
	);
	return supplemented === record.evidence ? raw : { ...record, evidence: supplemented };
}

/**
 * Normalizes raw parsed JSON from LLM extraction before schema validation.
 *
 * Wraps flattened responses, aligns text evidence offsets with literal source positions,
 * and recovers supporting mealSlot evidence for expanded location events.
 */
export function normalizeFoodExtractionEnvelope(raw: unknown, textBody?: string | null): unknown {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
	const record = raw as Record<string, unknown>;
	return (
		wrapFlattenedCandidate(record, textBody) ?? normalizeCandidateEnvelope(raw, record, textBody)
	);
}
