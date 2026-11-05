/** Escapes a source token before embedding it in a regular expression. */
export function escapeEvidenceToken(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches direct venue bindings and shared trailing venue clauses. */
export function batchAtVenue(raw: string, venue: string, clause: string): boolean {
	const direct = directVenue(raw, clause);
	if (direct) return direct === venue;
	const start = clause.toLowerCase().indexOf(raw.toLowerCase());
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
