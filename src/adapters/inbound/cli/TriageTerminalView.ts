import type {
	StagedAnnouncementMessage,
	ResolvedMealSwapInput,
} from "../../../core/ports/MessStagingRepositoryPort";
import type {
	ExtractedWeeklyMenu,
	ExtractedLocationDetail,
	ExtractedTimingExtension,
	ExtractedMealChange,
	ExtractedMealSwap,
	ExtractedCompositeAnnouncement,
} from "../../outbound/mess/extraction/ExtractionSchemas";

export interface TriageTerminalViewOptions {
	enableAnsi?: boolean;
}

// Clean ANSI styling constants
const RAW_ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
	blue: "\x1b[34m",
	gray: "\x1b[90m",
};

const NO_ANSI: typeof RAW_ANSI = {
	reset: "",
	bold: "",
	dim: "",
	green: "",
	yellow: "",
	red: "",
	cyan: "",
	magenta: "",
	blue: "",
	gray: "",
};

const DIVIDER_LINE =
	"========================================================================================";
const SUB_DIVIDER =
	"----------------------------------------------------------------------------------------";

/**
 * Strips ANSI escape sequences from text.
 */
export function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Formats a Date object into Indian Standard Time (IST) strings.
 */
export function formatIst(date: Date | null | undefined): string {
	if (!date || isNaN(date.getTime())) return "N/A";
	// Offset by +05:30
	const istMs = date.getTime() + (5 * 60 + 30) * 60 * 1000;
	const istDate = new Date(istMs);

	const yyyy = istDate.getUTCFullYear();
	const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(istDate.getUTCDate()).padStart(2, "0");
	const hh = String(istDate.getUTCHours()).padStart(2, "0");
	const min = String(istDate.getUTCMinutes()).padStart(2, "0");
	const ss = String(istDate.getUTCSeconds()).padStart(2, "0");

	return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} IST`;
}

export function formatIstAmPm(date: Date | null | undefined): string {
	if (!date || isNaN(date.getTime())) return "N/A";
	const istMs = date.getTime() + (5 * 60 + 30) * 60 * 1000;
	const istDate = new Date(istMs);

	const yyyy = istDate.getUTCFullYear();
	const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(istDate.getUTCDate()).padStart(2, "0");

	let hours = istDate.getUTCHours();
	const ampm = hours >= 12 ? "PM" : "AM";
	hours = hours % 12;
	hours = hours ? hours : 12; // 0 becomes 12
	const hh = String(hours).padStart(2, "0");
	const min = String(istDate.getUTCMinutes()).padStart(2, "0");

	return `${yyyy}-${mm}-${dd} ${hh}:${min} ${ampm} IST`;
}

export function getDayOfWeekName(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	return dayNames[d.getUTCDay()] ?? "";
}

export function getDayOfWeekShort(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	return dayNames[d.getUTCDay()] ?? "";
}

export class TriageTerminalView {
	private readonly ansi: typeof RAW_ANSI;

	constructor(options?: TriageTerminalViewOptions) {
		this.ansi = options?.enableAnsi === false ? NO_ANSI : RAW_ANSI;
	}

	/**
	 * Formats the list of staged WhatsApp messages as an interactive CLI table.
	 */
	renderMessagesTable(messages: StagedAnnouncementMessage[]): string {
		const lines: string[] = [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.cyan}📥 STAGED FOOD ANNOUNCEMENTS INBOX (${messages.length} messages)${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
		];

		if (messages.length === 0) {
			lines.push(`${this.ansi.gray}No staged food announcement messages found.${this.ansi.reset}`);
			lines.push(DIVIDER_LINE);
			return lines.join("\n");
		}

		messages.forEach((msg, idx) => {
			const num = String(idx + 1).padStart(2, " ");
			const timeStr = formatIst(msg.receivedAt);
			const sender = `${msg.senderAddress} (${msg.senderAddressType})`;

			let typeDetails: string = msg.messageType;
			if (msg.mediaMimeType) {
				if (msg.mediaMimeType.includes("pdf")) typeDetails = "document (pdf)";
				else if (msg.mediaMimeType.includes("image")) typeDetails = "image";
			}

			let statusColor = this.ansi.yellow;
			if (msg.status === "processed") statusColor = this.ansi.green;
			if (msg.status === "ignored") statusColor = this.ansi.gray;

			const snippet = msg.textBody
				? `"${msg.textBody.replace(/\r?\n/g, " ").slice(0, 35)}"`
				: `${this.ansi.dim}[No Text Body]${this.ansi.reset}`;

			lines.push(
				`[${this.ansi.bold}${num}${this.ansi.reset}] ` +
					`${this.ansi.dim}${timeStr}${this.ansi.reset}  ` +
					`${this.ansi.gray}${msg.id}${this.ansi.reset}  ` +
					`${this.ansi.cyan}${sender.padEnd(26, " ")}${this.ansi.reset}  ` +
					`${typeDetails.padEnd(16, " ")}  ` +
					`${statusColor}[${msg.status}]${this.ansi.reset}  ` +
					`${snippet}`,
			);
		});

		lines.push(this.ansi.bold + DIVIDER_LINE + this.ansi.reset);
		return lines.join("\n");
	}

	/**
	 * Formats the Pre-Extraction Inspection & Confirmation card matching Spec Section 4.2.
	 */
	renderInspectionCard(
		message: StagedAnnouncementMessage,
		selectedIntent?: string,
		selectedIntentIndex?: string | number,
	): string {
		const timeStr = formatIst(message.receivedAt);
		const sender = `${message.senderAddress} (${message.senderAddressType})`;

		let typeStr: string = message.messageType;
		if (message.mediaBuffer && message.mediaMimeType) {
			const kbSize = Math.round(message.mediaBuffer.length / 1024);
			typeStr = `${message.messageType} (${message.mediaMimeType}, ${kbSize} KB)`;
		} else if (message.mediaMimeType) {
			typeStr = `${message.messageType} (${message.mediaMimeType})`;
		}

		const captionOrFile = message.textBody ? `"${message.textBody.split("\n")[0]}"` : "[None]";
		const fullText = message.textBody ? message.textBody : "[None / Extracted filename]";

		if (selectedIntent) {
			const intentIdx = selectedIntentIndex || "1";
			return [
				this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
				`${this.ansi.bold}${this.ansi.cyan}🔍 MESSAGE INSPECTION & CONFIRMATION${this.ansi.reset}`,
				this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
				`Message ID:     ${message.id}`,
				`Sender:         ${sender}`,
				`Received At:    ${timeStr}`,
				`Message Type:   ${typeStr}`,
				`File / Caption: ${captionOrFile}`,
				`Full Text Body: ${fullText}`,
				`Selected Action:[${intentIdx}] ${selectedIntent}`,
				this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
				"Actions:",
				`  ${this.ansi.bold}[y]${this.ansi.reset} Proceed with Extraction`,
				`  ${this.ansi.bold}[o]${this.ansi.reset} Open Media (writes mediaBuffer to temp file and launches native viewer via xdg-open/open)`,
				`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel / Back to List`,
				DIVIDER_LINE,
			].join("\n");
		}

		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.cyan}🔍 MESSAGE INSPECTION${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Message ID:     ${message.id}`,
			`Sender:         ${sender}`,
			`Received At:    ${timeStr}`,
			`Message Type:   ${typeStr}`,
			`File / Caption: ${captionOrFile}`,
			`Full Text Body: ${fullText}`,
			DIVIDER_LINE,
		].join("\n");
	}

	/**
	 * Formats non-fatal extraction error card matching Spec Section 4.2.
	 */
	renderExtractionErrorCard(error: any, targetMessageId: string): string {
		const errorType = error?.name || error?.constructor?.name || "ExtractionError";
		const errorDetails = error?.message ? `"${error.message}"` : String(error);

		const validationLines: string[] = [];
		if (error?.cause?.issues && Array.isArray(error.cause.issues)) {
			validationLines.push(
				`${this.ansi.bold}${this.ansi.yellow}Validation Issues:${this.ansi.reset}`,
			);
			for (const issue of error.cause.issues) {
				const path = issue.path?.length ? issue.path.join(".") : "(root)";
				validationLines.push(`  • ${path}: ${issue.message}`);
			}
		}

		const rawResponseLines: string[] = [];
		if (error?.rawResponse) {
			rawResponseLines.push(
				this.ansi.bold +
					"- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -" +
					this.ansi.reset,
				`${this.ansi.bold}${this.ansi.cyan}Raw LLM Response:${this.ansi.reset}`,
				typeof error.rawResponse === "string"
					? error.rawResponse.trim()
					: JSON.stringify(error.rawResponse, null, 2),
			);
		}

		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.red}❌ EXTRACTION ENCOUNTERED AN ERROR${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Error Type:    ${this.ansi.bold}${errorType}${this.ansi.reset}`,
			`Error Details: ${this.ansi.red}${errorDetails}${this.ansi.reset}`,
			...(validationLines.length > 0 ? validationLines : []),
			`Target Message:${targetMessageId}`,
			`Staging State: ${this.ansi.yellow}UNCHANGED (message remains 'pending' in database)${this.ansi.reset}`,
			...(rawResponseLines.length > 0 ? rawResponseLines : []),
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Actions:",
			`  ${this.ansi.bold}[r]${this.ansi.reset} Retry Extraction (immediately re-attempts extraction on this message)`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel & Return to Message List`,
			DIVIDER_LINE,
		].join("\n");
	}

	/**
	 * Formats the weekly menu extraction preview matching Spec Section 4.4 Preview 1.
	 */
	renderWeeklyMenuPreview(menu: ExtractedWeeklyMenu): string {
		const meals = [...menu.meals];
		meals.sort((a, b) => {
			if (a.mealDate !== b.mealDate) return a.mealDate.localeCompare(b.mealDate);
			const slotOrder = { breakfast: 1, lunch: 2, dinner: 3 };
			return (slotOrder[a.mealSlot] ?? 0) - (slotOrder[b.mealSlot] ?? 0);
		});

		const uniqueDates = Array.from(new Set(meals.map((m) => m.mealDate))).sort();
		const startDate = uniqueDates[0] ?? "N/A";
		const endDate = uniqueDates[uniqueDates.length - 1] ?? "N/A";

		const startShort = getDayOfWeekShort(startDate);
		const endShort = getDayOfWeekShort(endDate);

		const totalDishes = meals.reduce((acc, m) => acc + m.items.length, 0);

		// Sanity checks
		const dateCount = uniqueDates.length;
		let isContiguous = dateCount === 7;
		if (isContiguous) {
			const startMs = Date.parse(`${startDate}T00:00:00Z`);
			const endMs = Date.parse(`${endDate}T00:00:00Z`);
			const expectedSpanMs = 6 * 86400000;
			if (endMs - startMs !== expectedSpanMs) {
				isContiguous = false;
			}
		}

		const contiguousCheck = isContiguous
			? `${this.ansi.green}✅ Contiguous 7-day span (Verified via UTC epoch: 86,400,000 ms/day)${this.ansi.reset}`
			: `${this.ansi.red}❌ Non-contiguous span (${dateCount} unique days)${this.ansi.reset}`;

		const slotsCheck =
			meals.length === 21
				? `${this.ansi.green}✅ All 3 slots present per day (21 meals total)${this.ansi.reset}`
				: `${this.ansi.yellow}⚠️ Warning: ${meals.length}/21 slots found${this.ansi.reset}`;

		const warnings: string[] = [];
		for (const m of meals) {
			if (m.items.length === 0) {
				warnings.push(
					`${this.ansi.yellow}⚠️ WARNING: ${m.mealSlot} on ${m.mealDate} has 0 items (fasting/holiday?)${this.ansi.reset}`,
				);
			}
		}

		const lines: string[] = [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.cyan}📋 WEEKLY MENU EXTRACTION PREVIEW${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Vendor:         ${this.ansi.bold}${menu.vendor}${this.ansi.reset} (Detected from document title)`,
			`Date Range:     ${startDate} (${startShort}) ➔ ${endDate} (${endShort}) [${dateCount} Days]`,
			`Total Slots:    21 meals (7 Breakfast, 7 Lunch, 7 Dinner)`,
			`Total Dishes:   ${totalDishes} items`,
			``,
			`Sanity Checks:  ${contiguousCheck}`,
			`                ${slotsCheck}`,
		];

		if (warnings.length > 0) {
			warnings.forEach((w) => lines.push(`                ${w}`));
		}

		lines.push(SUB_DIVIDER);

		// Group meals by date
		const mealsByDate = new Map<string, typeof meals>();
		for (const m of meals) {
			if (!mealsByDate.has(m.mealDate)) {
				mealsByDate.set(m.mealDate, []);
			}
			mealsByDate.get(m.mealDate)!.push(m);
		}

		for (const [date, dateMeals] of mealsByDate.entries()) {
			const dayName = getDayOfWeekName(date);
			lines.push(`📅 ${this.ansi.bold}${date} (${dayName})${this.ansi.reset}`);

			for (const m of dateMeals) {
				const slotCapital = m.mealSlot.charAt(0).toUpperCase() + m.mealSlot.slice(1);
				const slotPad = slotCapital.padEnd(9, " ");
				const countStr = `[${m.items.length} items]`;
				const itemsList = m.items.join(", ");
				lines.push(`  • ${this.ansi.bold}${slotPad}${this.ansi.reset} ${countStr}: ${itemsList}`);
			}
			lines.push("");
		}

		lines.push(
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Database Action:",
			`  • Upsert 21 rows into 'mess_meals' on conflict (meal_date, meal_slot, vendor) DO UPDATE`,
			`  • Update staging message status = 'processed'`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit to Database`,
			`  ${this.ansi.bold}[v]${this.ansi.reset} Switch Vendor (current: ${menu.vendor} ➔ [1] regular, [2] jain, [3] tcb)`,
			`  ${this.ansi.bold}[d]${this.ansi.reset} Shift Dates (enter new start date, e.g. if LLM shifted Sun ➔ Mon)`,
			`  ${this.ansi.bold}[e]${this.ansi.reset} Edit in vim (opens extracted JSON in vim, re-validates schema on save)`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel & Abort`,
			DIVIDER_LINE,
		);

		return lines.join("\n");
	}

	/**
	 * Formats the Location Seating preview matching Spec Section 4.4 Preview 2.
	 */
	renderLocationDetailPreview(
		detail: ExtractedLocationDetail,
		message?: StagedAnnouncementMessage,
	): string {
		const timeStr = formatIstAmPm(message?.receivedAt);
		const dayName = getDayOfWeekName(detail.mealDate);

		const hostel = detail.hostelBatches.length > 0 ? detail.hostelBatches.join(", ") : "None";
		const college = detail.collegeBatches.length > 0 ? detail.collegeBatches.join(", ") : "None";

		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.cyan}📍 ${detail.mealSlot.toUpperCase()} SEATING ALLOCATION PREVIEW${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Message Timestamp: ${timeStr}`,
			`Target Meal Date:  ${detail.mealDate} (${dayName})`,
			`Target Meal Slot:  ${detail.mealSlot}`,
			``,
			`🏢 ${this.ansi.bold}Hostel Mess (Cheftalk Regular & Jain):${this.ansi.reset}`,
			`   Allocated Batches: ${hostel}`,
			``,
			`🏫 ${this.ansi.bold}College Mess (TCB):${this.ansi.reset}`,
			`   Allocated Batches: ${college}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Database Action:",
			`  • Upsert 1 row into 'mess_meal_location_details' on conflict (meal_date, meal_slot) DO UPDATE`,
			`  • Update staging message status = 'processed'`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit`,
			`  ${this.ansi.bold}[d]${this.ansi.reset} Change Date (current: ${detail.mealDate})`,
			`  ${this.ansi.bold}[e]${this.ansi.reset} Edit Batches in vim`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			DIVIDER_LINE,
		].join("\n");
	}

	/**
	 * Formats the Timing Extension preview matching Spec Section 4.4 Preview 3.
	 */
	renderTimingExtensionPreview(
		extension: ExtractedTimingExtension,
		message?: StagedAnnouncementMessage,
	): string {
		const timeStr = formatIstAmPm(message?.receivedAt);
		const dayName = getDayOfWeekName(extension.mealDate);
		const vendorStr = extension.targetVendor ? extension.targetVendor : "All Vendors (Global)";

		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.cyan}⏰ MEAL TIMING EXTENSION PREVIEW${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Message Timestamp: ${timeStr}`,
			`Target Meal Date:  ${extension.mealDate} (${dayName})`,
			`Target Meal Slot:  ${extension.mealSlot}`,
			`Target Vendor:     ${vendorStr}`,
			`Extended Timings:  "${extension.extendedTimings}"`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Database Action:",
			`  • Insert 1 row into 'mess_meal_timing_extensions'`,
			`  • Update staging message status = 'processed'`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit`,
			`  ${this.ansi.bold}[v]${this.ansi.reset} Assign to specific vendor (current: ${vendorStr} ➔ [0] ALL, [1] regular, [2] jain, [3] tcb)`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			DIVIDER_LINE,
		].join("\n");
	}

	/**
	 * Formats the Meal Change preview matching Spec Section 4.4 Preview 4.
	 */
	renderMealChangePreview(
		change: ExtractedMealChange,
		message?: StagedAnnouncementMessage,
	): string {
		const timeStr = formatIstAmPm(message?.receivedAt);
		const dayName = getDayOfWeekName(change.mealDate);

		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.cyan}🍲 MEAL CHANGE / REPLACEMENT PREVIEW${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Message Timestamp: ${timeStr}`,
			`Target Meal Date:  ${change.mealDate} (${dayName})`,
			`Target Meal Slot:  ${change.mealSlot}`,
			`Target Vendor:     ${change.targetVendor}`,
			`Change Type:       ${change.changeType.toUpperCase()}`,
			``,
			`Original Dish:     ${change.originalItem ?? "None"}`,
			`New / Replaced:    ${change.affectedItem}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Database Action:",
			`  • Insert 1 row into 'mess_meal_changes'`,
			`  • Update staging message status = 'processed'`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit`,
			`  ${this.ansi.bold}[t]${this.ansi.reset} Change Type (current: ${change.changeType.toUpperCase()} ➔ [1] replacement, [2] addition, [3] cancellation)`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			DIVIDER_LINE,
		].join("\n");
	}

	/**
	 * Formats the Ignore Staged Message preview matching Spec Section 4.4 Preview 5.
	 */
	renderIgnorePreview(message: StagedAnnouncementMessage): string {
		const timeStr = formatIstAmPm(message.receivedAt);
		const sender = `${message.senderAddress} (${message.senderAddressType})`;
		const snippet = message.textBody
			? `"${message.textBody.replace(/\r?\n/g, " ").slice(0, 45)}..."`
			: "[None]";

		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.yellow}🚫 IGNORE STAGED MESSAGE${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Message ID: ${message.id}`,
			`Sender:     ${sender}`,
			`Received:   ${timeStr}`,
			`Type:       ${message.messageType}`,
			`Snippet:    ${snippet}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Database Action:",
			`  • Update 'whatsapp_group_food_announcements_messages' SET status = 'ignored'`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm Ignore | ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			DIVIDER_LINE,
		].join("\n");
	}

	/**
	 * Formats the Surgical Rollback / Processed Message card matching Spec Section 4.4.
	 */
	renderProcessedMessageCard(message: StagedAnnouncementMessage): string {
		const processedAtStr = formatIst(message.processedAt);
		const sender = `${message.senderAddress} (${message.senderAddressType})`;

		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.yellow}⚠️ PROCESSED MESSAGE ACTIONS${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Message ID:   ${message.id}`,
			`Sender:       ${sender}`,
			`Processed At: ${processedAtStr}`,
			`Associated:   Rows linked via 'source_message_id'`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Actions:",
			`  ${this.ansi.bold}[u]${this.ansi.reset} Undo / Revert Ingestion (deletes linked operational rows & resets status to 'pending')`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel / Back to List`,
			DIVIDER_LINE,
		].join("\n");
	}

	/**
	 * Formats unified composite announcement preview card matching Spec Section 5.2 and 5.3.
	 */
	renderCompositeAnnouncementCard(
		composite: ExtractedCompositeAnnouncement,
		resolvedSwaps?: ResolvedMealSwapInput[],
		missingSwaps?: ExtractedMealSwap[],
	): string {
		const lines: string[] = [
			`${this.ansi.bold}${this.ansi.cyan}┌─ Extracted Announcement Events (Date: ${composite.mealDate}) ──────────────────────────┐${this.ansi.reset}`,
		];

		// 1. Location
		if (composite.location) {
			const loc = composite.location;
			const slotStr = loc.mealSlot
				? `(${loc.mealSlot.charAt(0).toUpperCase() + loc.mealSlot.slice(1)})`
				: "(Lunch)";
			let locText = "";
			if (
				loc.hostelBatches &&
				loc.hostelBatches.length > 0 &&
				loc.collegeBatches &&
				loc.collegeBatches.length > 0
			) {
				locText = `${loc.hostelBatches.join(", ")} in Hostel | ${loc.collegeBatches.join(", ")} in College ${slotStr}`;
			} else if (loc.hostelBatches && loc.hostelBatches.length > 0) {
				locText = `${loc.hostelBatches.join(", ")} in Hostel ${slotStr}`;
			} else if (loc.collegeBatches && loc.collegeBatches.length > 0) {
				locText = `${loc.collegeBatches.join(", ")} in College ${slotStr}`;
			} else {
				locText = `None ${slotStr}`;
			}
			lines.push(`│  📍 Location: ${locText}`);
		} else {
			lines.push(`│  📍 Location: None`);
		}

		// 2. Timing
		if (composite.timingExtensions && composite.timingExtensions.length > 0) {
			composite.timingExtensions.forEach((t) => {
				const slotCap = t.mealSlot.charAt(0).toUpperCase() + t.mealSlot.slice(1);
				const vendorStr = t.targetVendor ? ` (${t.targetVendor})` : "";
				lines.push(`│  ⏰ Timing: ${slotCap}${vendorStr} ${t.extendedTimings}`);
			});
		} else {
			lines.push(`│  ⏰ Timing: None`);
		}

		// 3. Changes
		if (composite.mealChanges && composite.mealChanges.length > 0) {
			composite.mealChanges.forEach((c) => {
				const slotCap = c.mealSlot.charAt(0).toUpperCase() + c.mealSlot.slice(1);
				const vendorStr = c.targetVendor ? ` (${c.targetVendor})` : "";
				let changeDesc = "";
				if (c.changeType === "replacement" && c.originalItem) {
					changeDesc = `${c.originalItem} -> ${c.affectedItem} [${c.changeType}]`;
				} else {
					changeDesc = `${c.affectedItem} [${c.changeType}]`;
				}
				lines.push(`│  🔄 Changes: ${slotCap}${vendorStr}: ${changeDesc}`);
			});
		} else {
			lines.push(`│  🔄 Changes: None`);
		}

		// 4. Swaps
		if (composite.mealSwaps && composite.mealSwaps.length > 0) {
			composite.mealSwaps.forEach((s) => {
				const targetSlot = s.targetMealSlot.charAt(0).toUpperCase() + s.targetMealSlot.slice(1);
				const sourceSlot = s.sourceMealSlot.charAt(0).toUpperCase() + s.sourceMealSlot.slice(1);
				lines.push(
					`│  🔁 Meal Swap: ${s.targetMealDate} ${targetSlot} <- ${s.sourceMealDate} ${sourceSlot}`,
				);

				const matches = resolvedSwaps?.filter(
					(r) =>
						r.targetMealDate === s.targetMealDate &&
						r.targetMealSlot === s.targetMealSlot &&
						r.sourceMealDate === s.sourceMealDate &&
						r.sourceMealSlot === s.sourceMealSlot,
				);
				if (matches && matches.length > 0) {
					for (const resolved of matches) {
						const vendorLabel = resolved.vendor ? ` (${resolved.vendor})` : "";
						lines.push(`│     Resolved Items${vendorLabel}: [${resolved.newItems.join(", ")}]`);
					}
				}
			});
		} else {
			lines.push(`│  🔁 Swaps: None`);
		}

		lines.push(`└─────────────────────────────────────────────────────────────────────────────┘`);

		// 5. Hard Gate / Missing Swaps
		if (missingSwaps && missingSwaps.length > 0) {
			for (const m of missingSwaps) {
				if ((m as any).missingReason === "target") {
					const targetSlot = m.targetMealSlot.charAt(0).toUpperCase() + m.targetMealSlot.slice(1);
					lines.push(
						`${this.ansi.bold}${this.ansi.red}❌ Cannot Commit Swap: Target menu for ${m.targetMealDate} ${targetSlot} not found in database. Please ingest that date's weekly menu before committing this announcement.${this.ansi.reset}`,
					);
				} else {
					const sourceSlot = m.sourceMealSlot.charAt(0).toUpperCase() + m.sourceMealSlot.slice(1);
					lines.push(
						`${this.ansi.bold}${this.ansi.red}❌ Cannot Commit Swap: Source menu for ${m.sourceMealDate} ${sourceSlot} not found in database. Please ingest that date's weekly menu before committing this announcement.${this.ansi.reset}`,
					);
				}
			}
			lines.push(
				`Actions: ${this.ansi.bold}[e]${this.ansi.reset} Edit in Neovim | ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			);
		} else {
			lines.push(
				`Actions: ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit | ${this.ansi.bold}[e]${this.ansi.reset} Edit in Neovim | ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			);
		}

		return lines.join("\n");
	}
}
