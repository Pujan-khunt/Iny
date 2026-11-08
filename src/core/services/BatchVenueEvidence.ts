/** Escapes a source token before embedding it in a regular expression. */
export function escapeEvidenceToken(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches direct venue bindings and shared trailing venue clauses. */
export function batchAtVenue(raw: string, venue: string, clause: string): boolean {
	if (new RegExp(`\\b${venue}\\b`, "i").test(raw)) return true;
	const direct = directVenue(raw, clause);
	if (direct) return direct === venue;
	const bStart = /^\w/.test(raw) ? "\\b" : "";
	const bEnd = /\w$/.test(raw) ? "\\b" : "";
	const match = new RegExp(`${bStart}${escapeEvidenceToken(raw)}${bEnd}`, "i").exec(clause);
	const start = match ? match.index : clause.toLowerCase().indexOf(raw.toLowerCase());
	if (start < 0) return false;
	const remainder = clause.slice(start + raw.length);
	if (/^\s+[A-E]\b/i.test(remainder)) return false;
	return new RegExp(`\\b${venue}\\b`, "i").test(remainder);
}

function directVenue(raw: string, clause: string): string | null {
	for (const venue of ["hostel", "college"]) {
		const pattern = `\\b(?:${escapeEvidenceToken(raw)}\\s+(?:in|at)\\s+(?:the\\s+)?${venue}|${venue}\\s+for\\s+${escapeEvidenceToken(raw)})\\b`;
		if (new RegExp(pattern, "i").test(clause)) return venue;
	}
	return null;
}

function campusBatchAgrees(raw: string, path: string, clause: string): boolean {
	if (/^all(?:\s+(?:batches|students))?$/i.test(raw)) return true;
	const venue = /\/(hostel|college)Batches\//.exec(path)?.[1];
	if (!venue) return false;
	const hasVenue = new RegExp(`\\b(?:in|at)\\s+(?:the\\s+)?${venue}\\b|\\b${venue}\\b`, "i").test(
		raw,
	);
	const restrictive = /\b(?:202[7-9]|2030|except|other|remaining)\b/i.test(clause);
	return hasVenue && !restrictive;
}

/** Checks whether evidence for batch cohorts or campus groups agrees with source text. */
export function batchAgrees(value: string, raw: string, path: string, clause: string): boolean {
	if (value === "ALL_BATCHES") return campusBatchAgrees(raw, path, clause);
	if (value === "ALL_OTHER_BATCHES") {
		return (
			/^(?:all\s+)?(?:other|remaining)(?:\s+(?:batches|students))?$/i.test(raw) ||
			/^all\s+(?:batches|students)\s+except\s+.+$/i.test(raw)
		);
	}
	if (value.toLowerCase() === raw.toLowerCase()) return true;
	const parts = value.split(" ");
	if (parts.length === 2 && parts[1].toLowerCase() === raw.toLowerCase()) {
		const pattern = `\\b${parts[0]}\\b(?:[\\s,;/&()-]|and|to|[A-E])*?\\b${parts[1]}\\b`;
		return new RegExp(pattern, "i").test(clause);
	}
	return false;
}
