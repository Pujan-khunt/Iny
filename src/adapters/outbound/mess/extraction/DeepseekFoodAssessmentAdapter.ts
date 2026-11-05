import OpenAI from "openai";
import type { FoodAnnouncementSource as Source } from "../../../../core/entities/FoodAnnouncement";
import type { FoodAssessmentResult as Result } from "../../../../core/entities/FoodIngestion";
import type { FoodAssessmentPort } from "../../../../core/ports/FoodAssessmentPort";
import type { LoggerPort } from "../../../../core/ports/LoggerPort";
import type { PdfRasterizationPort } from "../../../../core/ports/PdfRasterizationPort";
import { cleanJsonResponse } from "./ExtractorUtils";
import * as schemas from "./FoodAssessmentSchemas";
import type { AssessmentAudit as Audit } from "./FoodAssessmentSchemas";
import {
	AssessmentError,
	classified,
	foodAssessmentRequest,
	prepareImageSource,
	rejection,
	stop,
} from "./FoodAssessmentRequest";
import { foodExtractionPrompt, foodPromptVersion } from "./FoodExtractionPrompt";
import { foodVerificationPrompt } from "./FoodVerificationPrompt";

/** Two isolated inference passes over the same original, without semantic retries. */
export class DeepseekFoodAssessmentAdapter implements FoodAssessmentPort {
	/** @param client Injected SDK client. @param pdf Bounded PDF renderer. @param model Explicit configured model. @param timeoutMs Request timeout in ms. @param dpi Rasterization DPI. @param logger Structured diagnostic logger. */
	constructor(
		private readonly client: OpenAI,
		private readonly pdf: PdfRasterizationPort,
		private readonly model: string,
		private readonly timeoutMs = 180_000,
		private readonly dpi = 300,
		private readonly logger?: LoggerPort,
	) {}

	/** @param source Original content. @param signal Invocation cancellation. @returns Strict raw candidate or rejection. @throws Error with plain FoodFailure and raw/model/prompt diagnostics. */
	async assess(source: Source, signal: AbortSignal): Promise<Result> {
		const audit = {
			rawExtraction: "",
			rawVerification: "",
			model: this.model,
			promptVersion: foodPromptVersion,
		};
		this.logger?.info("Starting food assessment", {
			messageId: source.messageId,
			type: source.messageType,
			model: this.model,
		});
		try {
			signal.throwIfAborted();
			if (!this.model.trim()) stop("configuration_error", "An explicit model is required.");
			const imageUrl = await prepareImageSource(source, this.pdf, this.dpi, signal);
			return await this.evaluate(source, signal, audit, imageUrl);
		} catch (error) {
			const failure = classified(error, signal);
			if (failure.code === "unsupported_type")
				return rejection(failure.code, failure.detail, audit);
			throw new AssessmentError({ ...failure, diagnostics: audit });
		}
	}

	private async extract(source: Source, signal: AbortSignal, audit: Audit, imageUrl?: string) {
		const t0 = Date.now();
		this.logger?.info("Pass 1: Requesting menu extraction from model", {
			messageId: source.messageId,
			model: this.model,
		});
		audit.rawExtraction = await this.infer(source, signal, audit, imageUrl);
		const extracted = schemas.FoodExtractionSchema.parse(
			JSON.parse(cleanJsonResponse(audit.rawExtraction)),
		);
		this.logger?.info("Pass 1: Menu extraction completed", {
			messageId: source.messageId,
			durationMs: Date.now() - t0,
			kind: extracted.kind,
		});
		return extracted;
	}

	private async verify(
		source: Source,
		signal: AbortSignal,
		audit: Audit,
		imageUrl?: string,
		proposal?: unknown,
	) {
		const t1 = Date.now();
		this.logger?.info("Pass 2: Requesting independent verification from model", {
			messageId: source.messageId,
			model: this.model,
		});
		audit.rawVerification = await this.infer(source, signal, audit, imageUrl, proposal);
		const v = schemas.FoodVerificationSchema.parse(
			JSON.parse(cleanJsonResponse(audit.rawVerification)),
		);
		const issues =
			v.missingFields.length + v.conflictingFields.length + v.unsupportedClauses.length;
		this.logger?.info("Pass 2: Verification completed", {
			messageId: source.messageId,
			durationMs: Date.now() - t1,
			verdict: v.verdict,
			completeCoverage: v.completeCoverage,
			issues,
		});
		return v;
	}

	private async evaluate(
		source: Source,
		signal: AbortSignal,
		audit: Audit,
		imageUrl?: string,
	): Promise<Result> {
		const extracted = await this.extract(source, signal, audit, imageUrl);
		if (extracted.kind !== "candidate")
			return rejection(
				extracted.kind === "unsupported" ? "unsupported_type" : "ambiguous_content",
				extracted.detail,
				audit,
			);
		const { candidate, evidence } = extracted;
		audit.recognizedType = candidate.kind;
		if ((source.messageType === "text") !== (candidate.kind === "operational_announcement"))
			stop("unsupported_type", "Candidate type does not match source medium.");
		const v = await this.verify(source, signal, audit, imageUrl, extracted);
		const issues =
			v.missingFields.length + v.conflictingFields.length + v.unsupportedClauses.length;
		if (v.verdict !== "accept" || !v.completeCoverage || issues) {
			this.logger?.warn("Food assessment verification rejected candidate", {
				messageId: source.messageId,
				verdict: v.verdict,
				conflictingFields: v.conflictingFields,
				missingFields: v.missingFields,
				unsupportedClauses: v.unsupportedClauses,
			});
			return rejection("ambiguous_content", JSON.stringify(v), audit);
		}
		return { kind: "candidate", candidate, evidence, verification: v, ...audit };
	}

	private async infer(
		source: Source,
		signal: AbortSignal,
		audit: Audit,
		imageUrl?: string,
		proposal?: unknown,
	): Promise<string> {
		signal.throwIfAborted();
		const prompt = proposal === undefined ? foodExtractionPrompt : foodVerificationPrompt;
		const response = await this.client.chat.completions.create(
			foodAssessmentRequest(source, this.model, prompt, imageUrl, proposal),
			{ timeout: this.timeoutMs, maxRetries: 0, signal },
		);
		const key = proposal === undefined ? "rawExtraction" : "rawVerification",
			raw = response?.choices?.[0]?.message?.content;
		audit[key] = typeof raw === "string" ? raw : "";
		signal.throwIfAborted();
		schemas.FoodCompletionSchema.parse(response);
		return audit[key];
	}
}
