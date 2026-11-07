import { downloadMediaMessage, normalizeMessageContent, WAMessage } from "@whiskeysockets/baileys";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import { WhatsAppContent, WhatsAppContentType } from "./NormalizedWhatsAppMessage";
import { WhatsAppMessagePreviewFormatter } from "./WhatsAppMessagePreviewFormatter";

type UnwrappedContent = NonNullable<ReturnType<typeof normalizeMessageContent>>;

/**
 * Extracts normalized content metadata and builds lazy media download closures
 * from raw Baileys WAMessage stanzas.
 */
export class WhatsAppMessageContentExtractor {
	/**
	 * Creates a new WhatsAppMessageContentExtractor instance.
	 *
	 * @param logger - Port for logging diagnostic events.
	 * @param defaultDownloadMediaFn - Function for downloading Baileys media attachments.
	 * @param retryDelaysMs - Retry backoff sequence for downloading media buffers.
	 */
	constructor(
		private readonly logger: LoggerPort,
		private readonly defaultDownloadMediaFn: typeof downloadMediaMessage = downloadMediaMessage,
		private readonly retryDelaysMs: readonly number[] = [100, 200],
	) {}

	/**
	 * Resolves normalized content payload metadata from a raw Baileys message.
	 *
	 * @param raw - The incoming raw Baileys WAMessage stanza.
	 * @returns The extracted content metadata describing type, text, and media details.
	 */
	extractContent(raw: WAMessage): WhatsAppContent {
		const unwrapped = raw.message ? normalizeMessageContent(raw.message) : null;
		if (!unwrapped) {
			const { preview, rawKeys } = WhatsAppMessagePreviewFormatter.formatUnsupported(raw.message);
			return { type: "unsupported", text: null, mimeType: null, preview, rawKeys };
		}

		const media = this.resolveMedia(unwrapped);
		if (media) return media;

		const text = unwrapped.conversation ?? unwrapped.extendedTextMessage?.text;
		if (text !== undefined && text !== null) {
			return {
				type: "text",
				text,
				mimeType: null,
				preview: WhatsAppMessagePreviewFormatter.formatText(text),
			};
		}

		const { preview, rawKeys } = WhatsAppMessagePreviewFormatter.formatUnsupported(raw.message);
		return { type: "unsupported", text: null, mimeType: null, preview, rawKeys };
	}

	/**
	 * Builds a lazy media download closure that fetches binary payloads on demand.
	 *
	 * @param raw - The incoming raw Baileys WAMessage stanza.
	 * @param contentType - The classified content type of the message.
	 * @returns An asynchronous closure resolving to a Buffer if downloadable media exists, or null.
	 */
	buildLazyMediaClosure(
		raw: WAMessage,
		contentType: WhatsAppContentType,
	): () => Promise<Buffer | null> {
		if (contentType !== "image" && contentType !== "document") {
			return async () => null;
		}

		return async (): Promise<Buffer | null> => {
			let lastError: unknown;
			const totalAttempts = this.retryDelaysMs.length + 1;
			for (let attempt = 0; attempt < totalAttempts; attempt++) {
				try {
					const downloaded = await this.defaultDownloadMediaFn(raw, "buffer", {});
					return Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as Uint8Array);
				} catch (error) {
					lastError = error;
					await this.waitForRetry(attempt);
				}
			}
			this.logger.warn("Failed to download media for message", lastError, {
				messageId: raw.key.id,
				remoteJid: raw.key.remoteJid,
			});
			return null;
		};
	}

	private async waitForRetry(attempt: number): Promise<void> {
		const delay = this.retryDelaysMs[attempt];
		if (delay !== undefined && delay > 0) {
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	/**
	 * Inspects unwrapped message content for supported media attachments (image or document).
	 */
	private resolveMedia(unwrapped: UnwrappedContent): WhatsAppContent | null {
		if (unwrapped.imageMessage) {
			const mimeType = unwrapped.imageMessage.mimetype ?? "image/jpeg";
			const caption = unwrapped.imageMessage.caption ?? null;
			return {
				type: "image",
				text: caption,
				mimeType,
				preview: WhatsAppMessagePreviewFormatter.formatImage(caption, mimeType),
			};
		}

		if (unwrapped.documentMessage) {
			const doc = unwrapped.documentMessage;
			const mimeType = doc.mimetype ?? "application/pdf";
			const text = doc.caption ?? doc.fileName ?? null;
			return {
				type: "document",
				text,
				mimeType,
				preview: WhatsAppMessagePreviewFormatter.formatDocument(
					doc.caption,
					doc.fileName,
					mimeType,
				),
			};
		}

		return null;
	}
}
