import OpenAI from "openai";
import { z } from "zod";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { FoodAnnouncementSource as Source } from "../../../../core/entities/FoodAnnouncement";
import type * as Food from "../../../../core/entities/FoodIngestion";
import type { PdfRasterizationPort } from "../../../../core/ports/PdfRasterizationPort";
import { formatHistoricalMessageTimeIST } from "../../../../core/utils/Temporal";

/** Typed internal assessment error carrying a domain failure classification. */
export class AssessmentError extends Error {
	constructor(readonly failure: Food.FoodFailure) {
		super(failure.detail);
	}
}

/** Throws a terminal non-retriable assessment error with the given code and detail. */
export function stop(code: string, detail: string): never {
	throw new AssessmentError({ code, detail, retriable: false });
}

/** Constructs a structured rejection result with diagnostic audit fields. */
export function rejection(
	reason: string,
	detail: string,
	audit: Record<string, unknown>,
): Food.FoodAssessmentResult {
	return { kind: "rejected", reason, detail, ...audit } as Food.FoodAssessmentResult;
}

function transient(error: unknown): boolean {
	const s = error instanceof OpenAI.APIError ? Number(error.status) : 0;
	return error instanceof OpenAI.APIConnectionError || s === 429 || (s >= 500 && s <= 599);
}

/** Classifies raw exceptions from SDK, validation, or abort signals into domain failures. */
export function classified(error: unknown, signal: AbortSignal): Food.FoodFailure {
	if (signal.aborted || error instanceof OpenAI.APIUserAbortError)
		return { code: "cancelled", detail: "Assessment cancelled.", retriable: false };
	if (error instanceof AssessmentError) return error.failure;
	if (error instanceof SyntaxError || error instanceof z.ZodError)
		return { code: "invalid_model_response", detail: error.message, retriable: false };
	const detail = error instanceof Error ? error.message : "Unknown assessment failure.",
		retriable = transient(error),
		backoff = retriable && error instanceof OpenAI.APIError ? foodRetryDelay(error.headers) : {};
	return { code: "assessment_failure", detail, retriable, ...backoff };
}

/** Validates that the source announcement contains minimal viable metadata. */
export function checkSource(source: Source): void {
	if (!Number.isFinite(source.originalCreatedAt?.getTime()))
		stop("invalid_source", "Original timestamp is required.");
	if (source.messageType === "text" && (!source.textBody?.trim() || source.mediaBytes))
		stop("unsupported_type", "Standalone nonempty text is required.");
}

function checkImage(bytes: Uint8Array | null, signal: AbortSignal): asserts bytes is Uint8Array {
	signal.throwIfAborted();
	if (!bytes?.length || bytes.length > 32 * 1024 * 1024)
		stop("media_limits", "Image exceeds 32 MiB or is empty.");
}

/** Validates and rasterizes source media into a base64 image data URL. */
export async function prepareImageSource(
	source: Source,
	pdf: PdfRasterizationPort,
	dpi: number,
	signal: AbortSignal,
): Promise<string | undefined> {
	checkSource(source);
	if (source.messageType === "text") return undefined;
	let mime = source.mediaMimeType,
		bytes = source.mediaBytes;
	checkImage(bytes, signal);
	if (source.messageType === "document") {
		if (mime !== "application/pdf") stop("unsupported_type", "Only PDF documents are supported.");
		const info = await pdf.inspect(bytes, signal);
		signal.throwIfAborted();
		if (info.pageCount !== 1) stop("unsupported_type", "PDF assessment requires exactly one page.");
		bytes = (await pdf.renderFirstPage(bytes, dpi, signal)).pngBytes;
		mime = "image/png";
	}
	if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime ?? ""))
		stop("unsupported_type", "Unsupported image MIME type.");
	checkImage(bytes, signal);
	return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Maps the immutable original and optional first-pass proposal into a fresh SDK request. */
export function foodAssessmentRequest(
	source: Source,
	model: string,
	prompt: string,
	imageUrl?: string,
	proposal?: unknown,
): ChatCompletionCreateParamsNonStreaming {
	const original_source = {
		messageType: source.messageType,
		textBody: source.textBody,
		mediaMimeType: source.mediaMimeType,
		originalCreatedAt: source.originalCreatedAt?.toISOString() ?? null,
		originalTimeIST: source.originalCreatedAt
			? formatHistoricalMessageTimeIST(source.originalCreatedAt)
			: null,
	};
	const data = JSON.stringify({ original_source, ...(proposal === undefined ? {} : { proposal }) });
	return {
		model,
		temperature: 0,
		reasoning_effort: "low",
		response_format: { type: "json_object" },
		messages: [
			{ role: "system", content: prompt },
			{
				role: "user",
				content: imageUrl
					? [
							{ type: "text", text: data },
							{ type: "image_url", image_url: { url: imageUrl } },
						]
					: data,
			},
		],
	};
}

/** Decodes provider backoff headers as plain milliseconds; the adapter decides retryability. */
export function foodRetryDelay(headers: Headers | undefined): { retryAfterMs?: number } {
	const ms = headers?.get("retry-after-ms"),
		after = headers?.get("retry-after");
	const delay = ms
		? Number(ms)
		: after
			? /^\d+(?:\.\d+)?$/.test(after)
				? Number(after) * 1000
				: Date.parse(after) - Date.now()
			: NaN;
	return Number.isFinite(delay) && delay >= 0 ? { retryAfterMs: delay } : {};
}

/** Returns the total defect count reported by independent verification. */
export function verificationIssueCount(v: {
	missingFields: readonly string[];
	conflictingFields: readonly string[];
	unsupportedClauses: readonly string[];
}): number {
	return v.missingFields.length + v.conflictingFields.length + v.unsupportedClauses.length;
}
