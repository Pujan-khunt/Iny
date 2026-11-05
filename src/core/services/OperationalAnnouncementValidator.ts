import type {
	FoodAnnouncementSource,
	FoodCandidate,
	SourceEvidence,
} from "../entities/FoodAnnouncement";
import type { ValidationResult } from "../entities/FoodIngestion";
import type {
	OperationalAnnouncement as Announcement,
	LocationUpdate,
	TimingUpdate,
} from "../entities/MessAnnouncement";
import { isValidISODate } from "../utils/Temporal";
import { AnnouncementEvidenceValidator } from "./AnnouncementEvidenceValidator";
import { batchAtVenue, escapeEvidenceToken } from "./BatchVenueEvidence";
import { isSupportedCampusBatch } from "./CampusBatchScope";
const slots = ["breakfast", "lunch", "dinner"];
const vendors = ["cheftalk_regular", "cheftalk_jain", "tcb"];
function allocation(location: LocationUpdate): boolean {
	const a = location.hostelBatches,
		b = location.collegeBatches;
	const all = [...a, ...b];
	if (!all.length || new Set(all).size !== all.length) return false;
	if (all.some((batch) => !isSupportedCampusBatch(batch))) return false;
	if (all.includes("ALL_BATCHES")) return all.length === 1;
	if (a.includes("ALL_OTHER_BATCHES")) return a.length === 1 && b.length > 0;
	if (b.includes("ALL_OTHER_BATCHES")) return b.length === 1 && a.length > 0;
	return !a.some((x) => b.some((y) => x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)));
}
function clock(parts: RegExpMatchArray): number {
	const hour = Number(parts[1]),
		marker = parts[3]?.toUpperCase();
	const hours = marker ? (hour % 12) + (marker === "PM" ? 12 : 0) : hour;
	return hours * 60 + Number(parts[2] ?? 0);
}
function timing(value: TimingUpdate): boolean {
	if (value.targetVendor !== null && !vendors.includes(value.targetVendor)) return false;
	const role = /\b(?:from|start(?:s|ing)?|until|till|end(?:s|ing)?|between|delay(?:ed)?)\b/i;
	if (!role.test(value.extendedTimings)) return false;
	const times = [...value.extendedTimings.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\b/gi)];
	const window = /\b(?:between|from.*(?:until|till|to))\b/i.test(value.extendedTimings);
	if (/\b(?:or|either|maybe)\b/i.test(value.extendedTimings)) return false;
	if (times.length !== (window ? 2 : 1)) return false;
	if (window && clock(times[0]) >= clock(times[1])) return false;
	return times.every(([, hour, minute, meridiem]) => {
		if (Number(minute ?? 0) > 59) return false;
		if (meridiem) return Number(hour) >= 1 && Number(hour) <= 12;
		return (
			minute !== undefined && (Number(hour) === 0 || (Number(hour) >= 13 && Number(hour) <= 23))
		);
	});
}
function timingSupport(evidence: readonly SourceEvidence[]): boolean {
	return evidence
		.filter((e) => e.fieldPath.endsWith("/extendedTimings"))
		.every((e) => {
			const tokens =
				/\b(?:from|until|till|to|between|starts?|ends?|delay(?:ed)?|\d{1,2}:\d{2}\s*(?:AM|PM)?|\d{1,2}\s*(?:AM|PM))\b/gi;
			const read = (text: string) =>
				text.match(tokens)?.map((v) => v.replace(/\s/g, "").toLowerCase());
			return JSON.stringify(read(e.rawValue)) === JSON.stringify(read(e.clause));
		});
}
function roles(announcement: Announcement, evidence: readonly SourceEvidence[]): boolean {
	return evidence.every((entry) => {
		const { fieldPath: path, clause, rawValue: raw } = entry;
		if (/\b(?:or|either|maybe)\b/i.test(clause)) return false;
		const batch = /\/(hostel|college)Batches\//.exec(path);
		if (batch) {
			const opposite = batch[1] === "hostel" ? "college" : "hostel";
			return batchAtVenue(raw, batch[1], clause) && !batchAtVenue(raw, opposite, clause);
		}
		const dish = /^\/announcement\/changes\/(\d+)\/(?:originalItem|affectedItem)$/.exec(path);
		if (!dish) return true;
		const change = announcement.changes[Number(dish[1])];
		if (change?.changeType !== "replacement") return !!change;
		const [old, replacement] = [change.originalItem ?? "", change.affectedItem].map(
			escapeEvidenceToken,
		);
		const pattern = `\\breplace\\s+${old}\\s+with\\s+${replacement}\\s*[.!?]?\\s*$`;
		return new RegExp(pattern, "i").test(clause);
	});
}
function supported(announcement: Announcement): boolean {
	if (!announcement.locations.every(allocation)) return false;
	if (conflictingLocations(announcement.locations)) return false;
	if (!announcement.timings.every(timing)) return false;
	return announcement.changes.every((change) => {
		if (!vendors.includes(change.targetVendor) || !change.affectedItem?.trim()) return false;
		const service = /^(?:whole\s+)?(?:breakfast|lunch|dinner|meal|service)(?:\s+service)?$/i;
		if (service.test(change.affectedItem)) return false;
		if (change.changeType === "replacement") return !!change.originalItem?.trim();
		return ["addition", "cancellation"].includes(change.changeType) && change.originalItem === null;
	});
}
function reject(reason: string, detail: string): ValidationResult<never> {
	return { ok: false, reason, detail };
}
function conflictingLocations(locations: readonly LocationUpdate[]): boolean {
	const keys = locations.map((location) => `${location.mealDate}/${location.mealSlot}`);
	return new Set(keys).size !== keys.length;
}
function validSource(source: FoodAnnouncementSource): boolean {
	return (
		source.messageType === "text" &&
		!!source.textBody?.trim() &&
		Number.isFinite(source.originalCreatedAt?.getTime())
	);
}
function validSlots(announcement: Announcement): boolean {
	const regular = [...announcement.locations, ...announcement.timings, ...announcement.changes];
	if (regular.some((e) => !slots.includes(e.mealSlot) || !isValidISODate(e.mealDate))) return false;
	return announcement.swaps.every(
		(swap) =>
			isValidISODate(swap.sourceMealDate) &&
			isValidISODate(swap.targetMealDate) &&
			slots.includes(swap.sourceMealSlot) &&
			slots.includes(swap.targetMealSlot) &&
			(swap.targetVendor === null || vendors.includes(swap.targetVendor ?? "")),
	);
}
/** Validates whole text announcements without inheriting legacy defaults. */
export class OperationalAnnouncementValidator {
	/** Returns all events together or rejects every event on any invalid scope or source fact. */
	static validate(
		candidate: Extract<FoodCandidate, { kind: "operational_announcement" }>,
		source: FoodAnnouncementSource,
		evidence: readonly SourceEvidence[],
	): ValidationResult<Announcement> {
		if (!validSource(source))
			return reject("ambiguous_content", "Standalone text and original timestamp are required.");
		if (!Object.values(candidate.announcement).some((events) => events.length))
			return reject("ambiguous_content", "No operational events.");
		if (
			!validSlots(candidate.announcement) ||
			!supported(candidate.announcement) ||
			!timingSupport(evidence) ||
			!roles(candidate.announcement, evidence)
		)
			return reject("ambiguous_content", "Incomplete or conflicting event scope.");
		const support = AnnouncementEvidenceValidator.validate(source, candidate, evidence);
		if (!support.ok) return support;
		return { ok: true, value: candidate.announcement };
	}
}
