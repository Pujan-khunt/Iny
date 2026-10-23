import OpenAI from "openai";
import {
	ExtractedLocationDetail,
	ExtractedLocationDetailSchema,
	ExtractedTimingExtension,
	ExtractedTimingExtensionSchema,
	ExtractedMealChange,
	ExtractedMealChangeSchema,
	ExtractedCompositeAnnouncement,
	ExtractedCompositeAnnouncementSchema,
} from "./ExtractionSchemas";
import {
	cleanJsonResponse,
	classifyAndThrowExtractorError,
	resolveOpenAiClient,
} from "./ExtractorUtils";
import { getISTDateString } from "../../../../core/entities/MessMeal";

export interface DeepseekTextExtractorOptions {
	client?: OpenAI;
	apiKey?: string;
	baseURL?: string;
	model?: string;
}

export class DeepseekTextExtractor {
	private readonly client: OpenAI;
	private readonly model: string;

	constructor(
		clientOrApiKeyOrOptions: OpenAI | string | DeepseekTextExtractorOptions,
		options?: { baseURL?: string; model?: string },
	) {
		const resolved = resolveOpenAiClient(clientOrApiKeyOrOptions, options);
		this.client = resolved.client;
		this.model = resolved.model;
	}

	/**
	 * Extracts lunch/meal location and batch allocation details from announcement text.
	 */
	async extractLocationDetail(
		textBody: string,
		receivedAt?: Date,
	): Promise<ExtractedLocationDetail> {
		const refDate = receivedAt ?? new Date();
		const istDateStr = getISTDateString(refDate);

		const systemPrompt = `You are an expert assistant extracting campus mess seating and location details from WhatsApp announcements.
Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr}).

Batch & Seating Rules:
1. Campus batches are identified by graduation years (e.g. "2027", "2028", "2029", "2030") or specific section labels (e.g. "2029 A", "2030 E"). NEVER invent or hallucinate academic terms like "UG1", "UG2", "PG1".
2. If ALL batches/students are assigned to the Hostel mess (e.g. "all in hostel", "lunch in hostel for all"), set:
   "hostelBatches": ["ALL_BATCHES"], "collegeBatches": []
3. If ALL batches/students are assigned to the College mess, set:
   "hostelBatches": [], "collegeBatches": ["ALL_BATCHES"]
4. If seating is split (e.g. "2028 and 2029 in Hostel, others in College"), extract the exact years for the specified location and use "ALL_OTHER_BATCHES" for the remaining location:
   "hostelBatches": ["2028", "2029"], "collegeBatches": ["ALL_OTHER_BATCHES"]
5. mealDate: ISO format YYYY-MM-DD. Resolve relative terms like "today", "tomorrow", or day-of-week relative to IST date ${istDateStr}.
6. mealSlot: "breakfast" | "lunch" | "dinner" (defaults to "lunch" if omitted or not explicitly mentioned).

Return ONLY a valid JSON object matching:
{
  "mealDate": "YYYY-MM-DD",
  "mealSlot": "lunch",
  "hostelBatches": ["..."],
  "collegeBatches": ["..."]
}`;

		const userPrompt = `Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr})\nAnnouncement text:\n"${textBody}"`;

		let content: string | undefined;
		try {
			const completion = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				response_format: { type: "json_object" },
			});

			content = completion.choices[0]?.message?.content ?? undefined;
			if (!content) {
				throw new Error("LLM returned empty response during location extraction");
			}

			const cleaned = cleanJsonResponse(content);
			const parsedJson = JSON.parse(cleaned);
			return ExtractedLocationDetailSchema.parse(parsedJson);
		} catch (error) {
			classifyAndThrowExtractorError(error, content);
		}
	}

	/**
	 * Extracts meal timing extension details from announcement text.
	 */
	async extractTimingExtension(
		textBody: string,
		receivedAt?: Date,
	): Promise<ExtractedTimingExtension> {
		const refDate = receivedAt ?? new Date();
		const istDateStr = getISTDateString(refDate);

		const systemPrompt = `You are an expert assistant extracting campus mess timing updates from WhatsApp announcements.
Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr}).

Requirements:
1. mealDate: ISO format YYYY-MM-DD. Resolve relative dates like "today" or "tomorrow" (including typos like "tommorow", "tmrw") relative to IST date ${istDateStr}. Explicit dates formatted as DD/MM/YY or DD/MM/YYYY (e.g. "20/10/26") resolve to ISO "YYYY-MM-DD" ("2026-10-20").
2. mealSlot: "breakfast" | "lunch" | "dinner".
3. targetVendor: "cheftalk_regular" | "cheftalk_jain" | "tcb" | null. Pass null if the timing applies globally to all mess vendors.
4. extendedTimings: A concise summary of the timing update, including early start times, service window changes, delays, or extensions (e.g. "From 12:00 PM", "Extended until 10:45 PM").

Return ONLY a valid JSON object matching:
{
  "mealDate": "YYYY-MM-DD",
  "mealSlot": "dinner",
  "targetVendor": null,
  "extendedTimings": "..."
}`;

		const userPrompt = `Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr})\nAnnouncement text:\n"${textBody}"`;

		let content: string | undefined;
		try {
			const completion = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				response_format: { type: "json_object" },
			});

			content = completion.choices[0]?.message?.content ?? undefined;
			if (!content) {
				throw new Error("LLM returned empty response during timing extension extraction");
			}

			const cleaned = cleanJsonResponse(content);
			const parsedJson = JSON.parse(cleaned);
			return ExtractedTimingExtensionSchema.parse(parsedJson);
		} catch (error) {
			classifyAndThrowExtractorError(error, content);
		}
	}

	/**
	 * Extracts dish replacements, additions, or cancellations from announcement text.
	 */
	async extractMealChange(textBody: string, receivedAt?: Date): Promise<ExtractedMealChange> {
		const refDate = receivedAt ?? new Date();
		const istDateStr = getISTDateString(refDate);

		const systemPrompt = `You are an expert assistant extracting campus mess dish changes from WhatsApp announcements.
Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr}).

Requirements:
1. mealDate: ISO format YYYY-MM-DD. Resolve relative dates like "today" or "tomorrow" relative to IST date ${istDateStr}.
2. mealSlot: "breakfast" | "lunch" | "dinner".
3. targetVendor: "cheftalk_regular" | "cheftalk_jain" | "tcb". If Cheftalk is mentioned without specifying Jain, default to "cheftalk_regular".
4. changeType: "replacement" | "addition" | "cancellation".
5. affectedItem: The new dish name or added dish or cancelled dish name.
6. originalItem: The dish being replaced (null if changeType is "addition" or "cancellation").

Return ONLY a valid JSON object matching:
{
  "mealDate": "YYYY-MM-DD",
  "mealSlot": "lunch",
  "targetVendor": "cheftalk_regular",
  "changeType": "replacement",
  "affectedItem": "Kadai Paneer",
  "originalItem": "Paneer Butter Masala"
}`;

		const userPrompt = `Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr})\nAnnouncement text:\n"${textBody}"`;

		let content: string | undefined;
		try {
			const completion = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				response_format: { type: "json_object" },
			});

			content = completion.choices[0]?.message?.content ?? undefined;
			if (!content) {
				throw new Error("LLM returned empty response during meal change extraction");
			}

			const cleaned = cleanJsonResponse(content);
			const parsedJson = JSON.parse(cleaned);
			return ExtractedMealChangeSchema.parse(parsedJson);
		} catch (error) {
			classifyAndThrowExtractorError(error, content);
		}
	}

	/**
	 * Extracts composite operational announcement events (location, timing extensions,
	 * dish changes, and one-way meal swaps) from WhatsApp announcement text in a single pass.
	 */
	async extractAnnouncementEvents(
		textBody: string,
		receivedAt?: Date,
	): Promise<ExtractedCompositeAnnouncement> {
		const refDate = receivedAt ?? new Date();
		const istDateStr = getISTDateString(refDate);
		const istFormattedTime = refDate.toLocaleString("en-US", {
			timeZone: "Asia/Kolkata",
			dateStyle: "full",
			timeStyle: "medium",
		});

		const systemPrompt = `You are an expert AI assistant that extracts operational mess meal events from campus WhatsApp announcements.
Message received timestamp: ${refDate.toISOString()} (IST: ${istFormattedTime}, Date: ${istDateStr}).

Extract all operational events described in the message into a single JSON object. A message may contain one or multiple events:
1. "location": Seating/venue arrangement by batch for a meal slot.
2. "timingExtensions": Timing changes, early start times, shifted hours, delays, or extensions for a meal slot (e.g. "Lunch will be arranged from 12 PM", "Dinner from 7:30 PM", "Extended till 15:00").
3. "mealChanges": Dish-level substitutions, additions, or cancellations.
4. "mealSwaps": Whole-meal menu substitutions by reference across dates/slots (e.g. "Today's dinner will serve tomorrow's lunch menu").

TEMPORAL GROUNDING & CALENDAR RESOLUTION:
- Reference Date in IST: ${istDateStr} (${istFormattedTime}).
- "today" refers to ${istDateStr}.
- "tomorrow" (including common typos like "tommorow", "tmrw") refers to the next day after ${istDateStr}.
- Explicit dates formatted as DD/MM/YY or DD/MM/YYYY (e.g. "20/10/26" or "20/10/2026") must be resolved to ISO format "YYYY-MM-DD" ("2026-10-20").
- "yesterday" refers to the day before ${istDateStr}.
- Day-of-week references (e.g. "Wednesday", "Friday") resolve to the next occurrence of that weekday relative to ${istDateStr}.
- All dates must be in ISO format: "YYYY-MM-DD".
- mealDate at top level: Primary ISO date of the announcement (defaults to ${istDateStr}).

EVENT EXTRACTION RULES:

1. Location Seating ("location"):
- Set to null if no venue/seating allocation is mentioned.
- Valid campus batches: "2027", "2028", "2029", "2030", "2030 E", "ALL_BATCHES", "ALL_OTHER_BATCHES".
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

		const userPrompt = `Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr})\nAnnouncement text:\n"${textBody}"`;

		let content: string | undefined;
		try {
			const completion = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				temperature: 0.0,
				response_format: { type: "json_object" },
			});

			content = completion.choices[0]?.message?.content ?? undefined;
			if (!content) {
				throw new Error("LLM returned empty response during announcement event extraction");
			}

			const cleaned = cleanJsonResponse(content);
			const parsedJson = JSON.parse(cleaned);

			if (parsedJson && typeof parsedJson === "object") {
				const topMealDate =
					typeof parsedJson.mealDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsedJson.mealDate)
						? parsedJson.mealDate
						: istDateStr;

				if (!parsedJson.mealDate || !/^\d{4}-\d{2}-\d{2}$/.test(parsedJson.mealDate)) {
					parsedJson.mealDate = topMealDate;
				}

				if (parsedJson.location && typeof parsedJson.location === "object") {
					if (
						!parsedJson.location.mealDate ||
						!/^\d{4}-\d{2}-\d{2}$/.test(parsedJson.location.mealDate)
					) {
						parsedJson.location.mealDate = topMealDate;
					}
				}

				if (Array.isArray(parsedJson.timingExtensions)) {
					for (const ext of parsedJson.timingExtensions) {
						if (ext && typeof ext === "object") {
							if (!ext.mealDate || !/^\d{4}-\d{2}-\d{2}$/.test(ext.mealDate)) {
								ext.mealDate = topMealDate;
							}
						}
					}
				}

				if (Array.isArray(parsedJson.mealChanges)) {
					for (const change of parsedJson.mealChanges) {
						if (change && typeof change === "object") {
							if (!change.mealDate || !/^\d{4}-\d{2}-\d{2}$/.test(change.mealDate)) {
								change.mealDate = topMealDate;
							}
						}
					}
				}

				if (Array.isArray(parsedJson.mealSwaps)) {
					for (const swap of parsedJson.mealSwaps) {
						if (swap && typeof swap === "object") {
							if (!swap.targetMealDate || !/^\d{4}-\d{2}-\d{2}$/.test(swap.targetMealDate)) {
								swap.targetMealDate = topMealDate;
							}
						}
					}
				}
			}

			return ExtractedCompositeAnnouncementSchema.parse(parsedJson);
		} catch (error) {
			classifyAndThrowExtractorError(error, content);
		}
	}
}
