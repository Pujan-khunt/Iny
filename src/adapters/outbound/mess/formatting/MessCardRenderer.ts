import {
	MealSlot,
	Vendor,
	MessMealChange,
	MessMealTimingExtension,
	MessMealLocationDetail,
	ResolvedMealInfo,
	isMealEnded,
} from "../../../../core/entities/MessMeal.js";

export const VENDOR_DISPLAY_NAMES: Record<Vendor, string> = {
	cheftalk_regular: "Cheftalk Regular",
	cheftalk_jain: "Cheftalk Jain",
	tcb: "TCB (Uniworld)",
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
 * Formats a calendar date 'YYYY-MM-DD' into 'DayOfWeek, D Mon' (e.g. 'Wed, 7 Oct').
 */
export function formatDateIST(dateStr: string): string {
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
	return `${weekday}, ${day} ${month}`;
}

/**
 * Formats standard card header with optional (Ended) tag.
 */
export function formatCardHeader(title: string, dateStr: string, isEnded: boolean): string {
	const formattedDate = formatDateIST(dateStr);
	const endedTag = isEnded ? " *(Ended)*" : "";
	return `🍽️ *${title}*${endedTag} (${formattedDate})`;
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
export function renderMultiVendorSlotDigest(info: ResolvedMealInfo, hasEnded: boolean): string {
	const slotName = info.mealSlot ? (SLOT_DISPLAY_NAMES[info.mealSlot] ?? "Meal") : "Meal";
	const header = formatCardHeader(`${slotName} Menu`, info.mealDate, hasEnded);

	const activeUpdates = renderActiveUpdatesBanner(info.mealChanges);
	const timingExt = renderTimingExtensionsSection(info.timingExtensions);

	let headerBlock = header;
	const banners: string[] = [];
	if (activeUpdates) banners.push(activeUpdates);
	if (timingExt) banners.push(timingExt);
	if (banners.length > 0) {
		headerBlock = `${header}\n${banners.join("\n")}`;
	}

	const sections: string[] = [headerBlock];

	const vendorOrder: Vendor[] = ["cheftalk_regular", "cheftalk_jain", "tcb"];
	const vendorLines: string[] = [];

	for (const v of vendorOrder) {
		const meal = info.meals.find((m) => m.vendor === v);
		if (meal) {
			const itemsStr = meal.items.map(sanitizeWhatsAppText).join(", ");
			vendorLines.push(`${VENDOR_EMOJIS[v]} *${VENDOR_DISPLAY_NAMES[v]}:* ${itemsStr}`);
		}
	}

	if (vendorLines.length > 0) {
		sections.push(vendorLines.join("\n"));
	}

	if (info.mealSlot === "lunch" && info.locationDetail) {
		const loc = renderLocationSection(info.locationDetail, false);
		if (loc) {
			sections.push(loc);
		}
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
): string {
	const slotName = info.mealSlot ? (SLOT_DISPLAY_NAMES[info.mealSlot] ?? "Meal") : "Meal";
	const vendorName = VENDOR_DISPLAY_NAMES[vendor] ?? vendor;
	const header = formatCardHeader(`${slotName} — ${vendorName}`, info.mealDate, hasEnded);

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
	const header = formatCardHeader(`${vendorName} — Full Day Menu`, info.mealDate, false);

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
	const slotLines: string[] = [];

	for (const slot of slotOrder) {
		const meal = info.meals.find((m) => m.mealSlot === slot && m.vendor === vendor);
		const slotEnded = isMealEnded(info.mealDate, slot, now);
		const endedTag = slotEnded ? " *(Ended):*" : ":*";
		const label = `${SLOT_EMOJIS[slot]} *${SLOT_DISPLAY_NAMES[slot]}${slotEnded ? "*" : ""}${endedTag}`;

		const itemsStr =
			meal && meal.items.length > 0
				? meal.items.map(sanitizeWhatsAppText).join(", ")
				: "Not available";

		slotLines.push(`${label} ${itemsStr}`);
	}

	if (slotLines.length > 0) {
		sections.push(slotLines.join("\n"));
	}

	if (info.locationDetail) {
		const loc = renderLocationSection(info.locationDetail, true);
		if (loc) {
			sections.push(loc);
		}
	}

	return sections.join("\n\n");
}
