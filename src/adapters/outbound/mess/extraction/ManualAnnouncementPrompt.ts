import { getISTDateString } from "../../../../core/utils/Temporal";

const instructions = `You are an expert AI assistant that extracts operational mess meal events from campus WhatsApp announcements.
Message received timestamp: {{timestamp}} (IST: {{istTime}}, Date: {{istDate}}).

Extract all operational events described in the message into a single JSON object. A message may contain one or multiple events:
1. "location": Seating/venue arrangement by batch for a meal slot.
2. "timingExtensions": Timing changes, early start times, shifted hours, delays, or extensions for a meal slot (e.g. "Lunch will be arranged from 12 PM", "Dinner from 7:30 PM", "Extended till 15:00").
3. "mealChanges": Dish-level substitutions, additions, or cancellations.
4. "mealSwaps": Whole-meal menu substitutions by reference across dates/slots (e.g. "Today's dinner will serve tomorrow's lunch menu").

TEMPORAL GROUNDING & CALENDAR RESOLUTION:
- Reference Date in IST: {{istDate}} ({{istTime}}).
- "today" refers to {{istDate}}.
- "tomorrow" (including common typos like "tommorow", "tmrw") refers to the next day after {{istDate}}.
- Explicit dates formatted as DD/MM/YY or DD/MM/YYYY (e.g. "20/10/26" or "20/10/2026") must be resolved to ISO format "YYYY-MM-DD" ("2026-10-20").
- "yesterday" refers to the day before {{istDate}}.
- Day-of-week references (e.g. "Wednesday", "Friday") resolve to the next occurrence of that weekday relative to {{istDate}}.
- All dates must be in ISO format: "YYYY-MM-DD".
- mealDate at top level: Primary ISO date of the announcement (defaults to {{istDate}}).

EVENT EXTRACTION RULES:

1. Location Seating ("location"):
- Set to null if no venue/seating allocation is mentioned.
- Valid campus batches: "2027"; "2028", "2028 A", "2028 B"; "2029", "2029 A", "2029 B", "2029 C", "2029 D"; "2030", "2030 A", "2030 B", "2030 C", "2030 D", "2030 E"; "ALL_BATCHES", "ALL_OTHER_BATCHES".
- A bare year means the whole cohort for that year. Preserve explicit groups such as "2029 B" exactly and never collapse them to "2029".
- NEVER invent or use generic academic labels like "UG1", "UG2", "PG1".
- If all batches are assigned to Hostel: hostelBatches = ["ALL_BATCHES"], collegeBatches = [].
- If all batches are assigned to College: hostelBatches = [], collegeBatches = ["ALL_BATCHES"].
- If split (e.g. "2028 and 2029 in Hostel, others in College"):
  hostelBatches = ["2028", "2029"], collegeBatches = ["ALL_OTHER_BATCHES"].
- mealDate: ISO "YYYY-MM-DD" (must match the announcement's meal date).
- mealSlot: "breakfast" | "lunch" | "dinner" (defaults to "lunch" if unspecified).

2. Timing Changes & Extensions ("timingExtensions"):
- Empty array [] if no timing update is mentioned.
- Captures ANY operational timing adjustment: early start times, modified service windows, delays, or extensions (e.g. "From 12:00 PM", "Arranged from 12 PM", "Extended till 15:00", "7:30 PM to 10:00 PM").
- mealDate: ISO "YYYY-MM-DD".
- mealSlot: "breakfast" | "lunch" | "dinner".
- targetVendor: "cheftalk_regular" | "cheftalk_jain" | "tcb" | null (null if all vendors).
- extendedTimings: Concise description of the timing update (e.g. "From 12:00 PM", "Extended till 15:00").

3. Dish Changes ("mealChanges"):
- Empty array [] if no dish changes are mentioned.
- mealDate: ISO "YYYY-MM-DD".
- mealSlot: "breakfast" | "lunch" | "dinner".
- targetVendor: "cheftalk_regular" | "cheftalk_jain" | "tcb" (if Cheftalk mentioned without specifying Jain, default to "cheftalk_regular").
- changeType: "replacement" | "addition" | "cancellation".
- affectedItem: The new dish name or added dish or cancelled dish name.
- originalItem: The dish being replaced (null if changeType is "addition" or "cancellation").

4. One-Way Meal Swaps ("mealSwaps"):
- Empty array [] if no whole-meal menu swap is mentioned.
- When an announcement swaps a meal with another meal's menu (e.g. "Today's dinner will serve tomorrow's lunch menu"):
  - targetMealDate: ISO date of the meal being replaced.
  - targetMealSlot: meal slot of the meal being replaced ("breakfast" | "lunch" | "dinner").
  - sourceMealDate: ISO date of the source meal whose menu is being used.
  - sourceMealSlot: meal slot of the source meal whose menu is being used ("breakfast" | "lunch" | "dinner").
  - targetVendor: "cheftalk_regular" | "cheftalk_jain" | "tcb" | null (null if unspecified or all vendors).

JSON OUTPUT FORMAT:
Return ONLY a valid JSON object matching:
{
  "mealDate": "YYYY-MM-DD",
  "location": null,
  "timingExtensions": [],
  "mealChanges": [],
  "mealSwaps": []
}
(Note: When location is not null, it must be an object with: { "mealDate": "YYYY-MM-DD", "mealSlot": "lunch", "hostelBatches": [...], "collegeBatches": [...] })`;

/**
 * Builds legacy manual-review instructions grounded in source time.
 * @param originalTime Original message timestamp, used for IST calendar resolution.
 * @returns System instructions and the source timestamp prefix for the user message.
 * @throws RangeError if the timestamp is invalid.
 */
export function manualAnnouncementPrompt(originalTime: Date): {
	system: string;
	userPrefix: string;
} {
	const timestamp = originalTime.toISOString();
	const istDate = getISTDateString(originalTime);
	const istTime = originalTime.toLocaleString("en-US", {
		timeZone: "Asia/Kolkata",
		dateStyle: "full",
		timeStyle: "medium",
	});
	const system = instructions
		.replaceAll("{{timestamp}}", timestamp)
		.replaceAll("{{istDate}}", istDate)
		.replaceAll("{{istTime}}", istTime);
	return { system, userPrefix: `Message received at: ${timestamp} (IST Date: ${istDate})` };
}
