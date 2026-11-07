import type OpenAI from "openai";
import type { TextAnnouncementExtractionPort } from "../../../../core/ports/TextAnnouncementExtractionPort";
import type { ExtractedCompositeAnnouncement } from "../../../common/mess/ExtractionSchemas";
import { getISTDateString } from "../../../../core/utils/Temporal";
import { manualAnnouncementPrompt } from "./ManualAnnouncementPrompt";
import { normalizeManualAnnouncement } from "./ManualAnnouncementNormalizer";
import { cleanJsonResponse, classifyAndThrowExtractorError } from "./ExtractorUtils";

/** Extracts composite operational announcements solely for manual operator review. */
export class DeepseekTextExtractor implements TextAnnouncementExtractionPort {
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
	 * Extracts all supported legacy events in one request using original source time.
	 * @param textBody Original announcement text without inferred content.
	 * @param originalTime Original source timestamp for IST relative dates.
	 * @returns The manual composite with its legacy date defaults; grants no automatic acceptance.
	 * @throws Typed provider, JSON, or schema errors with available raw response evidence.
	 */
	async extractAnnouncementEvents(
		textBody: string,
		originalTime: Date,
	): Promise<ExtractedCompositeAnnouncement> {
		const prompt = manualAnnouncementPrompt(originalTime);
		let content: string | undefined;
		try {
			const completion = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{ role: "system", content: prompt.system },
					{ role: "user", content: `${prompt.userPrefix}\nAnnouncement text:\n"${textBody}"` },
				],
				temperature: 0.0,
				response_format: { type: "json_object" },
			});
			content = completion.choices[0]?.message?.content ?? undefined;
			if (!content)
				throw new Error("LLM returned empty response during announcement event extraction");
			return normalizeManualAnnouncement(
				JSON.parse(cleanJsonResponse(content)),
				getISTDateString(originalTime),
			);
		} catch (error) {
			classifyAndThrowExtractorError(error, content);
		}
	}
}
