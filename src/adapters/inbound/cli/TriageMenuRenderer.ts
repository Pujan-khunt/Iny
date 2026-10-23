import type { StagedAnnouncementMessage } from "../../../core/ports/MessStagingRepositoryPort";
import {
	type AnsiTheme,
	RAW_ANSI,
	NO_ANSI,
	DIVIDER_LINE,
	formatIst,
	formatIstAmPm,
} from "./TriageAnsi";
import { TriageErrorCardRenderer } from "./TriageErrorCardRenderer";

export interface TriageMenuRendererOptions {
	enableAnsi?: boolean;
}

export class TriageMenuRenderer {
	private readonly ansi: AnsiTheme;
	private readonly errorCardRenderer: TriageErrorCardRenderer;

	constructor(options?: TriageMenuRendererOptions) {
		this.ansi = options?.enableAnsi === false ? NO_ANSI : RAW_ANSI;
		this.errorCardRenderer = new TriageErrorCardRenderer(options);
	}

	renderMessagesTable(messages: StagedAnnouncementMessage[]): string {
		const { ansi } = this;
		const border = ansi.bold + DIVIDER_LINE + ansi.reset;
		const title = `${ansi.bold}${ansi.cyan}📥 STAGED FOOD ANNOUNCEMENTS INBOX (${messages.length} messages)${ansi.reset}`;
		if (messages.length === 0) {
			return [
				border,
				title,
				border,
				`${ansi.gray}No staged food announcement messages found.${ansi.reset}`,
				DIVIDER_LINE,
			].join("\n");
		}
		const rows = messages.map((m, i) => this.formatTableRow(m, i));
		return [border, title, border, ...rows, border].join("\n");
	}

	private formatTableRow(m: StagedAnnouncementMessage, i: number): string {
		const { ansi } = this;
		const type = m.mediaMimeType?.includes("pdf")
			? "document (pdf)"
			: m.mediaMimeType?.includes("image")
				? "image"
				: m.messageType;
		const color =
			m.status === "processed" ? ansi.green : m.status === "ignored" ? ansi.gray : ansi.yellow;
		const snip = m.textBody
			? `"${m.textBody.replace(/\r?\n/g, " ").slice(0, 35)}"`
			: `${ansi.dim}[No Text Body]${ansi.reset}`;
		const sender = `${m.senderAddress} (${m.senderAddressType})`;
		return (
			`[${ansi.bold}${String(i + 1).padStart(2, " ")}${ansi.reset}] ` +
			`${ansi.dim}${formatIst(m.receivedAt)}${ansi.reset}  ` +
			`${ansi.gray}${m.id}${ansi.reset}  ` +
			`${ansi.cyan}${sender.padEnd(26, " ")}${ansi.reset}  ` +
			`${type.padEnd(16, " ")}  ` +
			`${color}[${m.status}]${ansi.reset}  ` +
			`${snip}`
		);
	}

	renderInspectionCard(
		m: StagedAnnouncementMessage,
		intent?: string,
		index?: string | number,
	): string {
		const { ansi } = this;
		const border = ansi.bold + DIVIDER_LINE + ansi.reset;
		const kb =
			m.mediaBuffer && m.mediaMimeType ? `, ${Math.round(m.mediaBuffer.length / 1024)} KB` : "";
		const type = m.mediaMimeType ? `${m.messageType} (${m.mediaMimeType}${kb})` : m.messageType;
		const title = intent ? "🔍 MESSAGE INSPECTION & CONFIRMATION" : "🔍 MESSAGE INSPECTION";
		const lines = [
			border,
			`${ansi.bold}${ansi.cyan}${title}${ansi.reset}`,
			border,
			`Message ID:     ${m.id}`,
			`Sender:         ${m.senderAddress} (${m.senderAddressType})`,
			`Received At:    ${formatIst(m.receivedAt)}`,
			`Message Type:   ${type}`,
			`File / Caption: ${m.textBody ? `"${m.textBody.split("\n")[0]}"` : "[None]"}`,
			`Full Text Body: ${m.textBody || "[None / Extracted filename]"}`,
		];
		if (intent) {
			lines.push(
				`Selected Action:[${index || "1"}] ${intent}`,
				border,
				"Actions:",
				`  ${ansi.bold}[y]${ansi.reset} Proceed with Extraction`,
				`  ${ansi.bold}[o]${ansi.reset} Open Media (writes mediaBuffer to temp file and launches native viewer via xdg-open/open)`,
				`  ${ansi.bold}[c]${ansi.reset} Cancel / Back to List`,
			);
		}
		lines.push(DIVIDER_LINE);
		return lines.join("\n");
	}

	renderExtractionErrorCard(error: unknown, targetMessageId: string): string {
		return this.errorCardRenderer.render(error, targetMessageId);
	}

	renderIgnorePreview(m: StagedAnnouncementMessage): string {
		const { ansi } = this;
		const border = ansi.bold + DIVIDER_LINE + ansi.reset;
		const snip = m.textBody ? `"${m.textBody.replace(/\r?\n/g, " ").slice(0, 45)}..."` : "[None]";
		return [
			border,
			`${ansi.bold}${ansi.yellow}🚫 IGNORE STAGED MESSAGE${ansi.reset}`,
			border,
			`Message ID: ${m.id}`,
			`Sender:     ${m.senderAddress} (${m.senderAddressType})`,
			`Received:   ${formatIstAmPm(m.receivedAt)}`,
			`Type:       ${m.messageType}`,
			`Snippet:    ${snip}`,
			border,
			"Database Action:",
			`  • Update 'whatsapp_group_food_announcements_messages' SET status = 'ignored'`,
			border,
			"Actions:",
			`  ${ansi.bold}[y]${ansi.reset} Confirm Ignore | ${ansi.bold}[c]${ansi.reset} Cancel`,
			DIVIDER_LINE,
		].join("\n");
	}

	renderProcessedMessageCard(m: StagedAnnouncementMessage): string {
		const { ansi } = this;
		const border = ansi.bold + DIVIDER_LINE + ansi.reset;
		return [
			border,
			`${ansi.bold}${ansi.yellow}⚠️ PROCESSED MESSAGE ACTIONS${ansi.reset}`,
			border,
			`Message ID:   ${m.id}`,
			`Sender:       ${m.senderAddress} (${m.senderAddressType})`,
			`Processed At: ${formatIst(m.processedAt)}`,
			`Associated:   Rows linked via 'source_message_id'`,
			border,
			"Actions:",
			`  ${ansi.bold}[u]${ansi.reset} Undo / Revert Ingestion (deletes linked operational rows & resets status to 'pending')`,
			`  ${ansi.bold}[c]${ansi.reset} Cancel / Back to List`,
			DIVIDER_LINE,
		].join("\n");
	}
}
