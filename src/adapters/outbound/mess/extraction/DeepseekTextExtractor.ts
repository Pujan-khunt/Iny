import OpenAI from 'openai';
import {
  ExtractedLocationDetail,
  ExtractedLocationDetailSchema,
  ExtractedTimingExtension,
  ExtractedTimingExtensionSchema,
  ExtractedMealChange,
  ExtractedMealChangeSchema,
} from './ExtractionSchemas.js';
import {
  cleanJsonResponse,
  classifyAndThrowExtractorError,
  resolveOpenAiClient,
} from './ExtractorUtils.js';
import { getISTDateString } from '../../../../core/entities/MessMeal.js';

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
    options?: { baseURL?: string; model?: string }
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
    receivedAt?: Date
  ): Promise<ExtractedLocationDetail> {
    const refDate = receivedAt ?? new Date();
    const istDateStr = getISTDateString(refDate);

    const systemPrompt = `You are an expert assistant extracting campus mess seating and location details from WhatsApp announcements.
Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr}).

Requirements:
1. mealDate: ISO format YYYY-MM-DD. Resolve relative terms like "today", "tomorrow", or day-of-week relative to IST date ${istDateStr}.
2. mealSlot: "breakfast" | "lunch" | "dinner" (defaults to "lunch" if omitted or not explicitly mentioned).
3. hostelBatches: array of student batch names assigned to the Hostel mess (e.g. ["UG1", "UG2", "PG1", "PhD"]). If all batches are at college mess, pass [].
4. collegeBatches: array of student batch names assigned to the College mess (e.g. ["UG3", "UG4", "PG2"]). If all batches are at hostel mess, pass [].

Return ONLY a valid JSON object matching:
{
  "mealDate": "YYYY-MM-DD",
  "mealSlot": "lunch",
  "hostelBatches": ["..."],
  "collegeBatches": ["..."]
}`;

    const userPrompt = `Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr})\nAnnouncement text:\n"${textBody}"`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM returned empty response during location extraction');
      }

      const cleaned = cleanJsonResponse(content);
      const parsedJson = JSON.parse(cleaned);
      return ExtractedLocationDetailSchema.parse(parsedJson);
    } catch (error) {
      classifyAndThrowExtractorError(error);
    }
  }

  /**
   * Extracts meal timing extension details from announcement text.
   */
  async extractTimingExtension(
    textBody: string,
    receivedAt?: Date
  ): Promise<ExtractedTimingExtension> {
    const refDate = receivedAt ?? new Date();
    const istDateStr = getISTDateString(refDate);

    const systemPrompt = `You are an expert assistant extracting campus mess timing extensions from WhatsApp announcements.
Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr}).

Requirements:
1. mealDate: ISO format YYYY-MM-DD. Resolve relative dates like "today" or "tomorrow" relative to IST date ${istDateStr}.
2. mealSlot: "breakfast" | "lunch" | "dinner".
3. targetVendor: "cheftalk_regular" | "cheftalk_jain" | "tcb" | null. Pass null if the extension applies globally to all mess vendors.
4. extendedTimings: A concise summary of the timing extension (e.g. "Extended until 10:45 PM due to college fest").

Return ONLY a valid JSON object matching:
{
  "mealDate": "YYYY-MM-DD",
  "mealSlot": "dinner",
  "targetVendor": null,
  "extendedTimings": "..."
}`;

    const userPrompt = `Message received at: ${refDate.toISOString()} (IST Date: ${istDateStr})\nAnnouncement text:\n"${textBody}"`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM returned empty response during timing extension extraction');
      }

      const cleaned = cleanJsonResponse(content);
      const parsedJson = JSON.parse(cleaned);
      return ExtractedTimingExtensionSchema.parse(parsedJson);
    } catch (error) {
      classifyAndThrowExtractorError(error);
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

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM returned empty response during meal change extraction');
      }

      const cleaned = cleanJsonResponse(content);
      const parsedJson = JSON.parse(cleaned);
      return ExtractedMealChangeSchema.parse(parsedJson);
    } catch (error) {
      classifyAndThrowExtractorError(error);
    }
  }
}
