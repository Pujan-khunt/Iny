const MAX_PREVIEW_LENGTH = 500;
const TRUNCATION_SUFFIX = " ... [truncated]";

/**
 * Normalizes message content into concise, single-line preview representations
 * and extracts raw container metadata keys for unsupported payloads.
 */
export class WhatsAppMessagePreviewFormatter {
	/**
	 * Formats text content into a single line truncated at 500 characters.
	 *
	 * @param text - Raw message text body.
	 * @returns Sanitized and bounded preview string.
	 */
	static formatText(text: string): string {
		const normalized = text.replace(/\s+/g, " ").trim();
		if (normalized.length <= MAX_PREVIEW_LENGTH) {
			return normalized;
		}
		return normalized.slice(0, MAX_PREVIEW_LENGTH) + TRUNCATION_SUFFIX;
	}

	/**
	 * Formats image preview including caption and MIME type.
	 *
	 * @param caption - Optional caption accompanying image attachment.
	 * @param mimeType - Image media MIME type string.
	 * @returns Single-line image preview string.
	 */
	static formatImage(caption: string | null | undefined, mimeType: string): string {
		if (caption && caption.trim().length > 0) {
			return `${WhatsAppMessagePreviewFormatter.formatText(caption)} (${mimeType})`;
		}
		return `[image without caption] (${mimeType})`;
	}

	/**
	 * Formats document preview including file name, optional caption, and MIME type.
	 *
	 * @param caption - Optional caption accompanying document.
	 * @param fileName - Optional file name of attachment.
	 * @param mimeType - Document MIME type string.
	 * @returns Single-line document preview string.
	 */
	static formatDocument(
		caption: string | null | undefined,
		fileName: string | null | undefined,
		mimeType: string,
	): string {
		const label = fileName ? `[document: ${fileName}]` : "[document]";
		if (caption && caption.trim().length > 0) {
			return `${label} ${WhatsAppMessagePreviewFormatter.formatText(caption)} (${mimeType})`;
		}
		return `${label} (${mimeType})`;
	}

	/**
	 * Formats unsupported message payloads with top-level raw envelope keys.
	 *
	 * @param rawMessage - Raw Baileys message record.
	 * @returns Object containing preview string and array of raw keys.
	 */
	static formatUnsupported(rawMessage: object | null | undefined): {
		readonly preview: string;
		readonly rawKeys: readonly string[];
	} {
		if (!rawMessage || typeof rawMessage !== "object") {
			return { preview: "[unsupported: empty]", rawKeys: [] };
		}
		const rawKeys = Object.keys(rawMessage);
		if (rawKeys.length === 0) {
			return { preview: "[unsupported: empty]", rawKeys: [] };
		}
		return {
			preview: `[unsupported: ${rawKeys.join(", ")}]`,
			rawKeys,
		};
	}
}
