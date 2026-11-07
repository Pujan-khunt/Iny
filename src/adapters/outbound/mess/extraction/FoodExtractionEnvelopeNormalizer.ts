interface EvidenceEntry {
	fieldPath: string;
	rawValue: string;
	clause: string;
	location: { kind: string; start: number; end: number };
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

function normalizeEvidenceEntry(entry: unknown, textBody?: string | null): unknown {
	if (!entry || typeof entry !== "object") return entry;
	const record = entry as Record<string, unknown>;
	const loc = record.location as Record<string, unknown> | undefined;
	if (loc?.kind !== "text" || typeof record.rawValue !== "string" || !Number.isInteger(loc.start))
		return entry;
	if (textBody) {
		const resolved = resolveSpan(record, loc, textBody);
		if (resolved) return resolved;
	}
	const expectedEnd = (loc.start as number) + record.rawValue.length;
	return loc.end === expectedEnd ? entry : { ...record, location: { ...loc, end: expectedEnd } };
}

function normalizeEvidenceList(evidence: unknown[], textBody?: string | null): unknown[] {
	let modified = false;
	const normalized = evidence.map((item) => {
		const next = normalizeEvidenceEntry(item, textBody);
		if (next !== item) modified = true;
		return next;
	});
	return modified ? normalized : evidence;
}

function deriveSlotEvidence(
	entry: EvidenceEntry,
	path: string,
	slot: string,
): EvidenceEntry | null {
	if (entry.location.kind !== "text") return null;
	const slotIdx = entry.clause.toLowerCase().search(new RegExp(`\\b${slot}\\b`));
	const rawIdx = entry.clause.indexOf(entry.rawValue);
	if (slotIdx < 0 || rawIdx < 0) return null;
	const start = entry.location.start - rawIdx + slotIdx;
	return {
		fieldPath: path,
		rawValue: entry.clause.slice(slotIdx, slotIdx + slot.length),
		clause: entry.clause,
		location: { kind: "text", start, end: start + slot.length },
	};
}

function supplementLocationEvidence(candidate: unknown, evidence: unknown[]): unknown[] {
	const ann = (candidate as { announcement?: { locations?: unknown[] } })?.announcement;
	if (!Array.isArray(ann?.locations)) return evidence;
	const byPath = new Map(
		evidence
			.filter(
				(e): e is EvidenceEntry => typeof (e as Record<string, unknown>)?.fieldPath === "string",
			)
			.map((e) => [e.fieldPath, e]),
	);
	const added: EvidenceEntry[] = [];
	ann.locations.forEach((rawLoc: unknown, i: number) => {
		const loc = rawLoc as { mealSlot?: unknown } | null | undefined;
		const slotPath = `/announcement/locations/${i}/mealSlot`;
		if (byPath.has(slotPath) || typeof loc?.mealSlot !== "string") return;
		const dateEntry = byPath.get(`/announcement/locations/${i}/mealDate`);
		const derived = dateEntry
			? deriveSlotEvidence(dateEntry, slotPath, loc.mealSlot.toLowerCase())
			: null;
		if (derived) {
			byPath.set(slotPath, derived);
			added.push(derived);
		}
	});
	return added.length > 0 ? [...evidence, ...added] : evidence;
}

function wrapFlattenedCandidate(
	record: Record<string, unknown>,
	textBody?: string | null,
): unknown {
	const isFlattened =
		(record.kind === "operational_announcement" && record.announcement) ||
		(record.kind === "weekly_menu" && record.menu);
	if (!isFlattened) return null;
	const { evidence, ...candidate } = record;
	const rawEvidence = Array.isArray(evidence) ? normalizeEvidenceList(evidence, textBody) : [];
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
		normalizeEvidenceList(record.evidence, textBody),
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
