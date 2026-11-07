function normalizeEvidenceEntry(entry: unknown): unknown {
	if (!entry || typeof entry !== "object") return entry;
	const record = entry as Record<string, unknown>;
	const loc = record.location;
	if (!loc || typeof loc !== "object") return entry;
	const locRecord = loc as Record<string, unknown>;
	if (
		locRecord.kind === "text" &&
		typeof record.rawValue === "string" &&
		typeof locRecord.start === "number" &&
		Number.isInteger(locRecord.start)
	) {
		const expectedEnd = locRecord.start + record.rawValue.length;
		if (locRecord.end === expectedEnd) return entry;
		return {
			...record,
			location: {
				...locRecord,
				end: expectedEnd,
			},
		};
	}
	return entry;
}

function normalizeEvidenceList(evidence: unknown[]): unknown[] {
	let modified = false;
	const normalized = evidence.map((item) => {
		const next = normalizeEvidenceEntry(item);
		if (next !== item) modified = true;
		return next;
	});
	return modified ? normalized : evidence;
}

function wrapFlattenedCandidate(record: Record<string, unknown>): unknown {
	const isFlattened =
		(record.kind === "operational_announcement" && record.announcement) ||
		(record.kind === "weekly_menu" && record.menu);
	if (!isFlattened) return null;
	const { evidence, ...candidate } = record;
	return {
		kind: "candidate",
		candidate,
		evidence: Array.isArray(evidence) ? normalizeEvidenceList(evidence) : [],
	};
}

function normalizeCandidateEnvelope(raw: unknown, record: Record<string, unknown>): unknown {
	if (record.kind !== "candidate" || !Array.isArray(record.evidence)) return raw;
	const evidence = normalizeEvidenceList(record.evidence);
	return evidence === record.evidence ? raw : { ...record, evidence };
}

/**
 * Normalizes raw parsed JSON from LLM extraction before schema validation.
 *
 * If the model flattens the response by returning root `kind: "operational_announcement"`
 * or `kind: "weekly_menu"`, this wraps it into the canonical `{ kind: "candidate", candidate, evidence }`
 * envelope expected by FoodExtractionSchema. Also aligns text evidence end offsets with rawValue length.
 */
export function normalizeFoodExtractionEnvelope(raw: unknown): unknown {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
	const record = raw as Record<string, unknown>;
	return wrapFlattenedCandidate(record) ?? normalizeCandidateEnvelope(raw, record);
}
