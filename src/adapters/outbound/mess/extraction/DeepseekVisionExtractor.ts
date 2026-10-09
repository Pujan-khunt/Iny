import OpenAI from 'openai';
import {
  ExtractedWeeklyMenu,
  ExtractedWeeklyMenuSchema,
} from './ExtractionSchemas.js';
import {
  cleanJsonResponse,
  classifyAndThrowExtractorError,
  resolveOpenAiClient,
} from './ExtractorUtils.js';

export interface DeepseekVisionExtractorOptions {
  client?: OpenAI;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface ExtractWeeklyMenuOptions {
  mimeType?: string;
  textContext?: string;
}

export class DeepseekVisionExtractor {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    clientOrApiKeyOrOptions: OpenAI | string | DeepseekVisionExtractorOptions,
    options?: { baseURL?: string; model?: string }
  ) {
    const resolved = resolveOpenAiClient(clientOrApiKeyOrOptions, options);
    this.client = resolved.client;
    this.model = resolved.model;
  }

  /**
   * Multimodal extraction of 7-day weekly menu (21 slots total) from an image buffer.
   *
   * @param input Raw image Buffer or object containing imageBuffer, mimeType, and optional textContext.
   * @param options Additional options such as mimeType and textContext.
   */
  async extractWeeklyMenu(
    input: Buffer | { imageBuffer: Buffer; mimeType?: string; textContext?: string },
    options?: ExtractWeeklyMenuOptions
  ): Promise<ExtractedWeeklyMenu> {
    let imageBuffer: Buffer;
    let mimeType: string;
    let textContext: string | undefined;

    if (Buffer.isBuffer(input)) {
      imageBuffer = input;
      mimeType = options?.mimeType ?? 'image/png';
      textContext = options?.textContext;
    } else {
      imageBuffer = input.imageBuffer;
      mimeType = input.mimeType ?? options?.mimeType ?? 'image/png';
      textContext = input.textContext ?? options?.textContext;
    }

    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const systemPrompt = `You are an expert OCR and menu parsing assistant for campus mess menus.
Analyze the provided mess menu image and extract the full weekly menu.

Requirements:
1. Vendor must be one of: "cheftalk_regular", "cheftalk_jain", "tcb".
   - If the menu mentions Cheftalk Jain, vendor is "cheftalk_jain".
   - If the menu mentions Cheftalk (general or regular), vendor is "cheftalk_regular".
   - If the menu mentions TCB or Uniworld, vendor is "tcb".
2. Convert all calendar dates into strict ISO format YYYY-MM-DD (e.g. 2026-10-04). Never use DD/MM/YYYY or text month names.
3. Every day across the 7-day span must contain exactly 3 slots: "breakfast", "lunch", "dinner" (strictly 21 meal slots total).
4. Do NOT include snacks.
5. "items" for each meal must be a non-empty array of dish strings (e.g. ["Poha", "Tea", "Apple"]).
6. Return ONLY a valid JSON object adhering to:
{
  "vendor": "cheftalk_regular" | "cheftalk_jain" | "tcb",
  "meals": [
    {
      "mealDate": "YYYY-MM-DD",
      "mealSlot": "breakfast" | "lunch" | "dinner",
      "items": ["dish1", "dish2"]
    }
  ]
}`;

    let userPrompt =
      'Extract the complete 7-day weekly menu (strictly 21 slots: breakfast, lunch, dinner for each day) from this image.';
    if (textContext) {
      userPrompt += `\n\nEmbedded document text context:\n${textContext}`;
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: userPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM returned empty response during menu extraction');
      }

      const cleaned = cleanJsonResponse(content);
      const parsedJson = JSON.parse(cleaned);
      return ExtractedWeeklyMenuSchema.parse(parsedJson);
    } catch (error) {
      classifyAndThrowExtractorError(error);
    }
  }
}
