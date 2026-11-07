import type { OperationalAnnouncement, StagedWeeklyMenu } from "./MessAnnouncement";

/** Original transport payload and provenance, without processing-time fallbacks. */
export interface FoodAnnouncementSource {
	readonly messageId: string;
	readonly groupJid: string;
	readonly senderAddress: string;
	readonly senderAddressType: "pn" | "lid";
	readonly deliveryMode: "notify" | "append";
	readonly originalCreatedAt: Date | null;
	readonly capturedAt: Date;
	readonly messageType: "text" | "image" | "document";
	readonly textBody: string | null;
	readonly mediaMimeType: string | null;
	readonly mediaBytes: Uint8Array | null;
}

/** Complete extraction candidate; validation is required before operational writes. */
export type FoodCandidate =
	| {
			readonly kind: "weekly_menu";
			readonly menu: StagedWeeklyMenu;
			readonly dateRange: { readonly start: string; readonly end: string };
	  }
	| {
			readonly kind: "operational_announcement";
			readonly announcement: OperationalAnnouncement;
	  };

/** Source support for a JSON-pointer field, including its complete source clause. */
export interface SourceEvidence {
	readonly fieldPath: string;
	readonly rawValue: string;
	readonly location:
		| { readonly kind: "text"; readonly start: number; readonly end: number }
		| { readonly kind: "image"; readonly page: 1; readonly row: string; readonly column: string };
	readonly clause: string;
}
