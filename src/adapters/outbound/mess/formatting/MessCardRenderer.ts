import {
	MealSlot,
	Vendor,
	MessMealChange,
	MessMealTimingExtension,
	MessMealLocationDetail,
	ResolvedMealInfo,
	isMealEnded,
} from "../../../../core/entities/MessMeal";
import { getISTDateString, shiftISODate } from "../../../../core/utils/Temporal";
import { MessCardPresenterPort } from "../../../../core/ports/MessCardPresenterPort";

export const VENDOR_DISPLAY_NAMES: Record<Vendor, string> = {
	cheftalk_regular: "Cheftalk",
	cheftalk_jain: "Cheftalk Jain",
	tcb: "TCB",
};

export const VENDOR_TIP_NAMES: Record<Vendor, string> = {
	cheftalk_regular: "Cheftalk",
	cheftalk_jain: "Cheftalk Jain",
	tcb: "TCB",
};

export const VENDOR_EMOJIS: Record<Vendor, string> = {
	cheftalk_regular: "🍛",
	cheftalk_jain: "🥗",
	tcb: "☕",
};

export const SLOT_DISPLAY_NAMES: Record<MealSlot, string> = {
	breakfast: "Breakfast",
	lunch: "Lunch",
	dinner: "Dinner",
};

export const SLOT_EMOJIS: Record<MealSlot, string> = {
	breakfast: "🌅",
	lunch: "🍛",
	dinner: "🌙",
};

/**
 * Sanitizes input text according to WhatsApp formatting rules:
 * - Converts markdown headers to plain text.
 * - Converts markdown bold (**text**) to WhatsApp bold (*text*).
 * - Converts list bullets (- / *) to WhatsApp bullets (•).
 * - Replaces internal underscores with spaces.
 * - Strips rogue backticks and tildes.
 * - Collapses consecutive whitespace.
 */
export function sanitizeWhatsAppText(input: string): string {
	let text = input;
	text = text.replace(/^#{1,6}\s*/gm, "");
	text = text.replace(/\*\*(.*?)\*\*/g, "*$1*");
	text = text.replace(/^[-*]\s+/gm, "• ");
	text = text.replace(/_/g, " ");
	text = text.replace(/[`~]/g, "");
	text = text.replace(/[ \t]+/g, " ");
	return text.trim();
}

/**
 * Formats a calendar date 'YYYY-MM-DD' into relative date with IST day and month:
 * - 'Today, Fri, 6 Nov'
 * - 'Tomorrow, Sat, 7 Nov'
 * - 'Yesterday, Thu, 5 Nov'
 * - 'Sun, 8 Nov' (fallback)
 */
export function formatDateIST(dateStr: string, now: Date = new Date()): string {
	const [y, m, d] = dateStr.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
	const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	const weekday = weekdays[date.getUTCDay()];
	const month = months[date.getUTCMonth()];
	const day = date.getUTCDate();

	const todayIST = getISTDateString(now);
	const tomorrowIST = shiftISODate(todayIST, 1);
	const yesterdayIST = shiftISODate(todayIST, -1);

	let prefix = "";
	if (dateStr === todayIST) {
		prefix = "Today, ";
	} else if (dateStr === tomorrowIST) {
		prefix = "Tomorrow, ";
	} else if (dateStr === yesterdayIST) {
		prefix = "Yesterday, ";
	}

	return `${prefix}${weekday}, ${day} ${month}`;
}

/**
 * Formats standard card header with optional (Ended) tag and date on a new line.
 */
export function formatCardHeader(
	title: string,
	dateStr: string,
	isEnded: boolean,
	now: Date = new Date(),
): string {
	const formattedDate = formatDateIST(dateStr, now);
	const endedTag = isEnded ? " *(Ended)*" : "";
	return `🍽️ *${title}*${endedTag}\n📅 ${formattedDate}`;
}

/**
 * Renders active dish change/replacement banner.
 */
export function renderActiveUpdatesBanner(changes: readonly MessMealChange[]): string | null {
	if (!changes || changes.length === 0) {
		return null;
	}

	const formatSingleChange = (change: MessMealChange): string => {
		const affected = sanitizeWhatsAppText(change.affectedItem);
		const vendorName = VENDOR_DISPLAY_NAMES[change.targetVendor] ?? change.targetVendor;

		switch (change.changeType) {
			case "replacement": {
				const original = change.originalItem ? sanitizeWhatsAppText(change.originalItem) : null;
				return original
					? `${affected} replacing ${original} at ${vendorName}`
					: `${affected} replaced at ${vendorName}`;
			}
			case "addition":
				return `${affected} added at ${vendorName}`;
			case "cancellation":
				return `${affected} cancelled at ${vendorName}`;
			default:
				return `${affected} update at ${vendorName}`;
		}
	};

	if (changes.length === 1) {
		return `📢 *Active Updates:* ${formatSingleChange(changes[0])}`;
	}

	const lines = changes.map((c) => `• ${formatSingleChange(c)}`);
	return `📢 *Active Updates:*\n${lines.join("\n")}`;
}

/**
 * Renders timing extensions banner.
 */
export function renderTimingExtensionsSection(
	extensions: readonly MessMealTimingExtension[],
): string | null {
	if (!extensions || extensions.length === 0) {
		return null;
	}

	const formatExtension = (ext: MessMealTimingExtension): string => {
		const text = sanitizeWhatsAppText(ext.extendedTimings);
		if (ext.targetVendor) {
			const vendorName = VENDOR_DISPLAY_NAMES[ext.targetVendor] ?? ext.targetVendor;
			return `${text} (${vendorName})`;
		}
		return text;
	};

	if (extensions.length === 1) {
		return `⏰ *Timings:* ${formatExtension(extensions[0])}`;
	}

	const lines = extensions.map((ext) => `• ${formatExtension(ext)}`);
	return `⏰ *Timings:*\n${lines.join("\n")}`;
}

function formatBatchList(batches: readonly string[]): string {
	if (
		batches.length === 1 &&
		(batches[0] === "ALL_BATCHES" || batches[0].toLowerCase() === "all batches")
	) {
		return "All batches";
	}
	if (
		batches.length === 1 &&
		(batches[0] === "ALL_OTHER_BATCHES" || batches[0].toLowerCase() === "all other batches")
	) {
		return "All other batches";
	}
	const joined = batches.map((b) => sanitizeWhatsAppText(b)).join(", ");
	if (!joined.toLowerCase().startsWith("batch")) {
		return `Batches ${joined}`;
	}
	return joined;
}

/**
 * Renders location section according to zero-trust rules.
 * Strictly returns null if detail is null.
 */
export function renderLocationSection(
	detail: MessMealLocationDetail | null,
	isFullDay = false,
): string | null {
	if (!detail) {
		return null;
	}

	const prefix = isFullDay ? "📍 *Lunch Location:*" : "📍 *Location:*";

	const hasHostel = detail.hostelBatches && detail.hostelBatches.length > 0;
	const hasCollege = detail.collegeBatches && detail.collegeBatches.length > 0;

	if (hasCollege && !hasHostel) {
		return `${prefix} College (All batches)`;
	}

	if (hasHostel && !hasCollege) {
		return `${prefix} Hostel (All batches)`;
	}

	if (hasHostel && hasCollege) {
		const hostelStr = formatBatchList(detail.hostelBatches);
		const collegeStr = formatBatchList(detail.collegeBatches);
		return `${prefix}\n• *Hostel:* ${hostelStr}\n• *College:* ${collegeStr}`;
	}

	return null;
}

/**
 * Quadrant 1 & 3: Multi-Vendor Slot Digest.
 */
export function renderMultiVendorSlotDigest(
	info: ResolvedMealInfo,
	hasEnded: boolean,
	now: Date = new Date(),
): string {
	const slotName = info.mealSlot ? (SLOT_DISPLAY_NAMES[info.mealSlot] ?? "Meal") : "Meal";
	const header = formatCardHeader(`${slotName} Menu`, info.mealDate, hasEnded, now);
	const banners = [
		renderActiveUpdatesBanner(info.mealChanges),
		renderTimingExtensionsSection(info.timingExtensions),
	].filter(Boolean) as string[];

	const sections: string[] = [banners.length > 0 ? `${header}\n${banners.join("\n")}` : header];
	const vendorOrder: Vendor[] = ["cheftalk_regular", "cheftalk_jain", "tcb"];

	for (const v of vendorOrder) {
		const meal = info.meals.find((m) => m.vendor === v);
		if (meal && meal.items.length > 0) {
			const items = meal.items.map((i) => `• ${sanitizeWhatsAppText(i)}`).join("\n");
			sections.push(`${VENDOR_EMOJIS[v]} *${VENDOR_DISPLAY_NAMES[v]}:*\n${items}`);
		}
	}

	if (info.mealSlot === "lunch" && info.locationDetail) {
		const loc = renderLocationSection(info.locationDetail, false);
		if (loc) sections.push(loc);
	}

	return sections.join("\n\n");
}

/**
 * Quadrant 2: Single-Vendor Slot Detail.
 */
export function renderSingleVendorSlotDetail(
	info: ResolvedMealInfo,
	vendor: Vendor,
	hasEnded: boolean,
	userDefaultVendor?: Vendor,
	now: Date = new Date(),
): string {
	const slotName = info.mealSlot ? (SLOT_DISPLAY_NAMES[info.mealSlot] ?? "Meal") : "Meal";
	const vendorName = VENDOR_DISPLAY_NAMES[vendor] ?? vendor;
	const header = formatCardHeader(`${vendorName} ${slotName}`, info.mealDate, hasEnded, now);

	const activeUpdates = renderActiveUpdatesBanner(
		info.mealChanges.filter((c) => c.targetVendor === vendor),
	);
	const timingExt = renderTimingExtensionsSection(
		info.timingExtensions.filter((e) => e.targetVendor === vendor || e.targetVendor === null),
	);

	let headerBlock = header;
	const banners: string[] = [];
	if (activeUpdates) banners.push(activeUpdates);
	if (timingExt) banners.push(timingExt);
	if (banners.length > 0) {
		headerBlock = `${header}\n${banners.join("\n")}`;
	}

	const sections: string[] = [headerBlock];

	const meal = info.meals.find((m) => m.vendor === vendor);
	if (meal && meal.items.length > 0) {
		const itemsLines = meal.items.map((i) => `• ${sanitizeWhatsAppText(i)}`);
		sections.push(itemsLines.join("\n"));
	}

	if (info.mealSlot === "lunch" && info.locationDetail) {
		const loc = renderLocationSection(info.locationDetail, false);
		if (loc) {
			sections.push(loc);
		}
	}

	if (userDefaultVendor && userDefaultVendor !== vendor) {
		const tipVendorName = VENDOR_TIP_NAMES[vendor] ?? vendor;
		sections.push(`_Tip: Say "set default to ${tipVendorName}" to make this your default vendor._`);
	}

	return sections.join("\n\n");
}

/**
 * Quadrant 4: Single-Vendor Full-Day Digest.
 */
export function renderSingleVendorFullDayDigest(
	info: ResolvedMealInfo,
	vendor: Vendor,
	now: Date,
): string {
	const vendorName = VENDOR_DISPLAY_NAMES[vendor] ?? vendor;
	const header = formatCardHeader(`${vendorName} Full Day Menu`, info.mealDate, false, now);

	const activeUpdates = renderActiveUpdatesBanner(
		info.mealChanges.filter((c) => c.targetVendor === vendor),
	);
	const timingExt = renderTimingExtensionsSection(
		info.timingExtensions.filter((e) => e.targetVendor === vendor || e.targetVendor === null),
	);

	let headerBlock = header;
	const banners: string[] = [];
	if (activeUpdates) banners.push(activeUpdates);
	if (timingExt) banners.push(timingExt);
	if (banners.length > 0) {
		headerBlock = `${header}\n${banners.join("\n")}`;
	}

	const sections: string[] = [headerBlock];

	const slotOrder: MealSlot[] = ["breakfast", "lunch", "dinner"];

	for (const slot of slotOrder) {
		const meal = info.meals.find((m) => m.mealSlot === slot && m.vendor === vendor);
		const slotEnded = isMealEnded(info.mealDate, slot, now);
		const endedTag = slotEnded ? " *(Ended):*" : ":*";
		const label = `${SLOT_EMOJIS[slot]} *${SLOT_DISPLAY_NAMES[slot]}${slotEnded ? "*" : ""}${endedTag}`;

		if (meal && meal.items.length > 0) {
			const items = meal.items.map((i) => `• ${sanitizeWhatsAppText(i)}`).join("\n");
			sections.push(`${label}\n${items}`);
		} else {
			sections.push(`${label}\n• Not available`);
		}
	}

	if (info.locationDetail) {
		const loc = renderLocationSection(info.locationDetail, true);
		if (loc) {
			sections.push(loc);
		}
	}

	return sections.join("\n\n");
}

export const defaultMessCardPresenter: MessCardPresenterPort = {
	renderMultiVendorSlotDigest,
	renderSingleVendorSlotDetail,
	renderSingleVendorFullDayDigest,
};
