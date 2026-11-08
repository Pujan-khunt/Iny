interface EvidenceEntry {
	fieldPath: string;
	rawValue: string;
	clause: string;
	location: { kind: string; start: number; end: number };
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

/** Recovers missing mealSlot evidence entries for expanded operational location events. */
export function supplementLocationEvidence(candidate: unknown, evidence: unknown[]): unknown[] {
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
