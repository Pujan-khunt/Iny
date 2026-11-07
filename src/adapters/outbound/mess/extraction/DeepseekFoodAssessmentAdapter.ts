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
	verificationIssueCount,
} from "./FoodAssessmentRequest";
import { selectExtractionPrompt } from "./OperationalExtractionPrompt";
import { normalizeFoodExtractionEnvelope } from "./FoodExtractionEnvelopeNormalizer";
import { foodVerificationPrompt } from "./FoodVerificationPrompt";

/** Two isolated inference passes over the same original, without semantic retries. */
export class DeepseekFoodAssessmentAdapter implements FoodAssessmentPort {
	constructor(
		private readonly client: OpenAI,
		private readonly pdf: PdfRasterizationPort,
		private readonly model: string,
		private readonly logger: LoggerPort,
		private readonly timeoutMs = 180_000,
		private readonly dpi = 300,
	) {}

	/** @param source Original content. @param signal Invocation cancellation. */
	async assess(source: Source, signal: AbortSignal): Promise<Result> {
		const audit = {
			rawExtraction: "",
			rawVerification: "",
			model: this.model,
			promptVersion: schemas.foodPromptVersion,
		};
		this.logger.info("Starting food assessment", {
			id: source.messageId,
			type: source.messageType,
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
		const target = source.messageType === "text" ? "operational announcement" : "weekly menu";
		this.logger.info(`Pass 1: Requesting ${target} extraction`, { id: source.messageId });
		audit.rawExtraction = await this.infer(source, signal, audit, imageUrl);
		const normalized = normalizeFoodExtractionEnvelope(
			JSON.parse(cleanJsonResponse(audit.rawExtraction)),
		);
		const extracted = schemas.FoodExtractionSchema.parse(normalized);
		this.logger.info("Pass 1: Extraction completed", {
			id: source.messageId,
			elapsedMs: Date.now() - t0,
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
		this.logger.info("Pass 2: Requesting independent verification", { id: source.messageId });
		audit.rawVerification = await this.infer(source, signal, audit, imageUrl, proposal);
		const v = schemas.FoodVerificationSchema.parse(
			JSON.parse(cleanJsonResponse(audit.rawVerification)),
		);
		const issues = verificationIssueCount(v);
		this.logger.info("Pass 2: Verification completed", {
			id: source.messageId,
			elapsedMs: Date.now() - t1,
			verdict: v.verdict,
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
		if (v.verdict !== "accept" || !v.completeCoverage || verificationIssueCount(v) > 0) {
			this.logger.warn("Food assessment verification rejected candidate", {
				id: source.messageId,
				verdict: v.verdict,
				conflicting: v.conflictingFields,
				missing: v.missingFields,
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
		const prompt =
			proposal === undefined ? selectExtractionPrompt(source.messageType) : foodVerificationPrompt;
		const response = await this.client.chat.completions.create(
			foodAssessmentRequest(source, this.model, prompt, imageUrl, proposal),
			{ timeout: this.timeoutMs, maxRetries: 0, signal },
		);
		const key = proposal === undefined ? "rawExtraction" : "rawVerification";
		audit[key] = response?.choices?.[0]?.message?.content ?? "";
		signal.throwIfAborted();
		schemas.FoodCompletionSchema.parse(response);
		return audit[key];
	}
}
