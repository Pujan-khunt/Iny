import type { MealSlot, Vendor } from "./MessMeal";
import type {
	MenuCorrection,
	MenuExtractionResult,
	StagedCompositeAnnouncement,
	StagedWeeklyMenu,
} from "./MessAnnouncement";

/** Existing meal insert input, including optional generated ID and vendor. */
export interface CommitMealsInput {
	id?: string;
	mealDate: string;
	mealSlot: MealSlot;
	vendor?: Vendor;
	items: readonly string[] | string[];
}

/** Existing manually reviewed location insert input. */
export type CommitLocationDetailInput = NonNullable<StagedCompositeAnnouncement["location"]>;

/** Existing manually reviewed timing insert input. */
export type CommitTimingExtensionInput = NonNullable<
	StagedCompositeAnnouncement["timingExtensions"]
>[number];

/** Existing manually reviewed dish-change insert input. */
export type CommitMealChangeInput = NonNullable<StagedCompositeAnnouncement["mealChanges"]>[number];

/** Source and target meal snapshots required for a safe whole-meal substitution. */
export interface ResolvedMealSwapInput {
	targetMealDate: string;
	targetMealSlot: MealSlot;
	vendor: Vendor;
	newItems: string[];
	previousItems: string[];
	sourceMealDate: string;
	sourceMealSlot: MealSlot;
}

/** Manual extraction and optional operator review evidence, independent of automatic job state. */
export interface MenuExtractionAudit extends MenuExtractionResult {
	readonly reviewedMenu?: StagedWeeklyMenu;
	readonly reviewCorrections: readonly MenuCorrection[];
}

/** Legacy operational payload with optional menu extraction/review audit metadata. */
export interface CommitOperationalPayload {
	vendor?: Vendor;
	meals?: CommitMealsInput[];
	weeklyMenu?: StagedWeeklyMenu;
	locationDetails?: CommitLocationDetailInput | CommitLocationDetailInput[];
	locationDetail?: CommitLocationDetailInput;
	timingExtensions?: CommitTimingExtensionInput | CommitTimingExtensionInput[];
	timingExtension?: CommitTimingExtensionInput;
	mealChanges?: CommitMealChangeInput | CommitMealChangeInput[];
	mealChange?: CommitMealChangeInput;
	extractionAudit?: MenuExtractionAudit;
}

/** Existing atomic manual commit request keyed by its staged message. */
export type AtomicCommitOptions = CommitOperationalPayload & { messageId: string };

/** Existing atomic composite commit request with resolved swap snapshots. */
export interface AtomicCommitCompositeOptions {
	messageId: string;
	composite: StagedCompositeAnnouncement;
	resolvedSwaps?: ResolvedMealSwapInput[];
}

/** Read-only operation history projection; JSON evidence remains plain value data. */
export interface MessOperationAuditRecord {
	readonly operationId: string;
	readonly sourceMessageId: string;
	readonly originalCreatedAt: Date | null;
	readonly mode: "manual" | "automatic";
	readonly affectedFactKeys: readonly string[];
	readonly extractionEvidence: unknown;
	readonly reviewEvidence: unknown;
	readonly corrections: unknown;
	readonly beforeImages: unknown;
	readonly afterImages: unknown;
	readonly createdAt: Date;
	readonly reversedAt: Date | null;
	readonly reversalReason: string | null;
}
/** Persisted automatic evidence and independent manual/automatic operation history. */
export interface MessIngestionAudit {
	readonly automatic: {
		readonly state: string;
		readonly decisionReason: string | null;
		readonly decisionDetail: string | null;
		readonly rawExtraction: string | null;
		readonly rawVerification: string | null;
		readonly model: string | null;
		readonly promptVersion: string | null;
		readonly recognizedType: string | null;
		readonly candidate: unknown;
		readonly evidence: unknown;
		readonly verification: unknown;
		readonly corrections: unknown;
		readonly completedAt: Date | null;
	} | null;
	readonly operations: readonly MessOperationAuditRecord[];
}
