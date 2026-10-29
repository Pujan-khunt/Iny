import { downloadMediaMessage, normalizeMessageContent, WAMessage } from "@whiskeysockets/baileys";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import { NormalizedWhatsAppMessage, WhatsAppContentType } from "./NormalizedWhatsAppMessage";

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
	 */
	constructor(
		private readonly logger: LoggerPort,
		private readonly defaultDownloadMediaFn: typeof downloadMediaMessage = downloadMediaMessage,
	) {}

	/**
	 * Resolves normalized content payload metadata from a raw Baileys message.
	 *
	 * Unwraps container messages (e.g. view-once, ephemeral) and classifies
	 * content into text, image, document, or unsupported payloads.
	 *
	 * @param raw - The incoming raw Baileys WAMessage stanza.
	 * @returns The extracted content metadata describing type, text, and media details.
	 */
	extractContent(raw: WAMessage): NormalizedWhatsAppMessage["content"] {
		const unwrapped = raw.message ? normalizeMessageContent(raw.message) : null;
		if (!unwrapped) {
			return { type: "unsupported", text: null, mimeType: null };
		}

		const media = this.resolveMedia(unwrapped);
		if (media) {
			return media;
		}

		const text = unwrapped.conversation ?? unwrapped.extendedTextMessage?.text;
		if (text !== undefined && text !== null) {
			return { type: "text", text, mimeType: null };
		}

		return { type: "unsupported", text: null, mimeType: null };
	}

	/**
	 * Builds a lazy media download closure that fetches binary payloads on demand.
	 *
	 * Defers network and memory consumption until a downstream handler explicitly
	 * invokes downloadMedia. Non-media messages resolve immediately to null.
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
			try {
				const downloaded = await this.defaultDownloadMediaFn(raw, "buffer", {});
				return Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as Uint8Array);
			} catch (error) {
				this.logger.warn("Failed to download media for message", error, {
					messageId: raw.key.id,
					remoteJid: raw.key.remoteJid,
				});
				return null;
			}
		};
	}

	/**
	 * Inspects unwrapped message content for supported media attachments (image or document).
	 *
	 * @param unwrapped - The unwrapped Baileys IMessage structure.
	 * @returns Extracted media content metadata, or null if neither image nor document is present.
	 */
	private resolveMedia(unwrapped: UnwrappedContent): NormalizedWhatsAppMessage["content"] | null {
		if (unwrapped.imageMessage) {
			return {
				type: "image",
				text: unwrapped.imageMessage.caption ?? null,
				mimeType: unwrapped.imageMessage.mimetype ?? "image/jpeg",
			};
		}

		if (unwrapped.documentMessage) {
			const doc = unwrapped.documentMessage;
			return {
				type: "document",
				text: doc.caption ?? doc.fileName ?? null,
				mimeType: doc.mimetype ?? "application/pdf",
			};
		}

		return null;
	}
}
