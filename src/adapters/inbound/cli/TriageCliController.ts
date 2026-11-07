import type { MessStagingRepositoryPort } from "../../../core/ports/MessStagingRepositoryPort";
import type { CliIo } from "./TriageIo";
import type { TriageTerminalView } from "./TriageTerminalView";
import type { TriageMessageActions } from "./TriageMessageActions";
import type { TriageWeeklyMenuController } from "./TriageWeeklyMenuController";
import type { TriageAnnouncementController } from "./TriageAnnouncementController";

/** Optional inbox filters; defaults to ten messages. */
export interface RunTriageOptions {
	limit?: number;
	date?: string;
}

/** Selects staged messages and delegates manual actions without constructing dependencies. */
export class TriageCliController {
	/** Injects presentation, staging queries, and focused interactive flows. */
	constructor(
		private readonly io: CliIo,
		private readonly view: TriageTerminalView,
		private readonly staging: MessStagingRepositoryPort,
		private readonly actions: TriageMessageActions,
		private readonly weekly: TriageWeeklyMenuController,
		private readonly announcement: TriageAnnouncementController,
	) {}
	/** Releases the injected input resource. */
	close(): void {
		this.io.close?.();
	}
	/** Runs until quit or empty inbox; database failures reject after input is closed. */
	async run(options: RunTriageOptions = {}): Promise<void> {
		try {
			while (await this.select(options)) {
				/* Continue until quit or empty. */
			}
		} finally {
			this.close();
		}
	}
	private async select(options: RunTriageOptions): Promise<boolean> {
		const messages = await this.staging.listStagedMessages({
			limit: options.limit ?? 10,
			date: options.date,
		});
		this.io.print(this.view.renderMessagesTable(messages));
		if (!messages.length) {
			this.io.print("No staged food announcement messages found.");
			return false;
		}
		const input = (
			await this.io.prompt(`Select message [1-${messages.length}] or [q] to quit: `)
		).toLowerCase();
		if (input === "q" || input === "quit") return false;
		const index = parseInt(input, 10);
		if (isNaN(index) || index < 1 || index > messages.length) {
			this.io.print("Invalid selection index. Please enter a valid number or [q] to quit.");
			return true;
		}
		const message = messages[index - 1];
		this.io.print(this.view.renderInspectionCard(message));
		this.io.print(this.view.renderIngestionAudit(await this.staging.getIngestionAudit(message.id)));
		const action = await this.actions.select(message);
		if (action === "weekly") await this.weekly.run(message);
		if (action === "announcement") await this.announcement.run(message);
		return true;
	}
}
