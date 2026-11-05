import type {
	MessStagingRepositoryPort,
	StagedAnnouncementMessage,
} from "../../../core/ports/MessStagingRepositoryPort";
import type { MediaPreviewer } from "./MediaPreviewer";
import type { CliIo } from "./TriageIo";
import type { TriageTerminalView } from "./TriageTerminalView";

/** Drives manual action selection, viewing, ignore confirmation, and surgical undo. */
export class TriageMessageActions {
	/** Dependencies are supplied by the administrative entrypoint. */
	constructor(
		private readonly io: CliIo,
		private readonly view: TriageTerminalView,
		private readonly staging: MessStagingRepositoryPort,
		private readonly previewer: MediaPreviewer,
	) {}
	/** Returns the selected extraction flow; cancellation and handled mutations return null. */
	async select(message: StagedAnnouncementMessage): Promise<"weekly" | "announcement" | null> {
		if (message.status === "processed") return this.undo(message);
		const media = this.isMedia(message);
		while (true) {
			const action = await this.choose(media);
			if (action === "cancel") return null;
			if (action === "ignore") return this.ignore(message);
			if (action === "announcement") return "announcement";
			if (action === "weekly") return (await this.inspectWeekly(message)) ? "weekly" : null;
			if (action === "preview") await this.preview(message);
			else this.io.print("Invalid choice.");
		}
	}
	private isMedia(message: StagedAnnouncementMessage): boolean {
		return Boolean(message.mediaMimeType || message.mediaBuffer || message.messageType !== "text");
	}
	private async choose(media: boolean): Promise<string> {
		this.printActions(media);
		const choice = (
			await this.io.prompt(media ? "Choice [1-4/c]: " : "Choice [1/2/c]: ")
		).toLowerCase();
		const actions: Record<string, string> = media
			? {
					"1": "weekly",
					"2": "announcement",
					"3": "preview",
					"4": "ignore",
					"5": "ignore",
					c: "cancel",
				}
			: { "1": "announcement", "2": "ignore", c: "cancel" };
		return actions[choice];
	}
	private printActions(media: boolean): void {
		this.io.print("\nSelect action:");
		if (media) {
			this.io.print(
				"  [1] Extract Weekly Menu\n  [2] Process Announcement (Auto-Extract All Events)\n  [3] Open in Viewer\n  [4] Ignore Message",
			);
		} else {
			this.io.print("  [1] Process Announcement (Auto-Extract All Events)\n  [2] Ignore Message");
		}
		this.io.print("  [c] Cancel / Back to List");
	}
	private async inspectWeekly(message: StagedAnnouncementMessage): Promise<boolean> {
		while (true) {
			this.io.print(this.view.renderInspectionCard(message, "Weekly Menu", "1"));
			const choice = (await this.io.prompt("Choice [y/o/c]: ")).toLowerCase();
			if (choice === "y") return true;
			if (choice === "c") return false;
			if (choice === "o") await this.preview(message);
		}
	}
	private async preview(message: StagedAnnouncementMessage): Promise<void> {
		if (!message.mediaBuffer || !message.mediaMimeType) {
			this.io.print("No binary media attached to this message.");
			return;
		}
		const result = await this.previewer.previewMedia(
			Buffer.from(message.mediaBuffer),
			message.mediaMimeType,
			message.textBody ?? undefined,
		);
		this.io.print(
			result.success
				? `Media opened in native viewer: ${result.filePath}`
				: `Failed to launch viewer: ${result.error}`,
		);
	}
	private async ignore(message: StagedAnnouncementMessage): Promise<null> {
		this.io.print(this.view.renderIgnorePreview(message));
		if ((await this.io.prompt("Choice [y/c]: ")).toLowerCase() === "y") {
			await this.staging.markIgnored(message.id);
			this.io.print(`Message ${message.id} marked as ignored.`);
		}
		return null;
	}
	private async undo(message: StagedAnnouncementMessage): Promise<null> {
		this.io.print(this.view.renderProcessedMessageCard(message));
		if ((await this.io.prompt("Choice [u/c]: ")).toLowerCase() === "u") {
			await this.staging.atomicUndo(message.id);
			this.io.print("Surgically reverted message ingestion. Status reset to pending.");
		}
		return null;
	}
}
