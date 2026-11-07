import type {
	FoodCandidate,
	FoodAnnouncementSource,
	SourceEvidence,
} from "../entities/FoodAnnouncement";

/** Returns true when an unlabeled media menu follows the group's TCB convention. */
export function isUnlabeledTcb(
	candidate: FoodCandidate,
	source: FoodAnnouncementSource,
	evidence: readonly SourceEvidence[],
): boolean {
	return (
		candidate.kind === "weekly_menu" &&
		candidate.menu.vendor === "tcb" &&
		source.messageType !== "text" &&
		!source.textBody?.trim() &&
		!evidence.some((entry) => entry.fieldPath === "/menu/vendor")
	);
}
