import type OpenAI from "openai";
import { ExtractedWeeklyMenuSchema } from "../../../common/mess/ExtractionSchemas";
import type {
	MenuExtractionPort,
	ExtractWeeklyMenuOptions,
} from "../../../../core/ports/MenuExtractionPort";
import type { MenuExtractionResult } from "../../../../core/entities/MessAnnouncement";
import { MenuDishNormalizer } from "../../../../core/services/MenuDishNormalizer";
import { weeklyMenuPrompt } from "./WeeklyMenuPrompt";
import { cleanJsonResponse, classifyAndThrowExtractorError } from "./ExtractorUtils";

/** Extracts raw weekly menus and approved spelling corrections for manual review. */
export class DeepseekVisionExtractor implements MenuExtractionPort {
	/**
	 * Injects external dependencies without constructing an SDK client.
	 * @param client Configured SDK client shared by the administrative entrypoint.
	 * @param model Explicit provider model name used for every request.
	 */
	constructor(
		private readonly client: OpenAI,
		private readonly model: string,
	) {}

	/**
	 * Extracts a complete weekly menu from image bytes with optional caption/document context.
	 * @param image Complete original image bytes or a rendered PDF page.
	 * @param options Source MIME type and optional caption/document context.
	 * @returns Independent raw and normalized menus with approved correction provenance.
	 * @throws Typed provider, JSON, or schema errors with available raw response evidence.
	 */
	async extractWeeklyMenu(
		image: Uint8Array,
		options?: ExtractWeeklyMenuOptions,
	): Promise<MenuExtractionResult> {
		let content: string | undefined;
		try {
			const completion = await this.client.chat.completions.create(this.request(image, options));
			content = completion.choices[0]?.message?.content ?? undefined;
			if (!content) throw new Error("LLM returned empty response during menu extraction");
			const rawMenu = ExtractedWeeklyMenuSchema.parse(JSON.parse(cleanJsonResponse(content)));
			return MenuDishNormalizer.normalize(rawMenu);
		} catch (error) {
			classifyAndThrowExtractorError(error, content);
		}
	}

	private request(
		image: Uint8Array,
		options?: ExtractWeeklyMenuOptions,
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
		const prompt = weeklyMenuPrompt(options?.textContext);
		const dataUrl = `data:${options?.mimeType ?? "image/png"};base64,${Buffer.from(image).toString("base64")}`;
		return {
			model: this.model,
			messages: [
				{ role: "system", content: prompt.system },
				{
					role: "user",
					content: [
						{ type: "text", text: prompt.user },
						{ type: "image_url", image_url: { url: dataUrl } },
					],
				},
			],
			response_format: { type: "json_object" },
		};
	}
}
