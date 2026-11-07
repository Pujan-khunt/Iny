import type {
	StagedCompositeAnnouncement,
	StagedMealSwap,
} from "../../../core/entities/MessAnnouncement";
import type { ResolvedMealSwapInput } from "../../../core/entities/MessCommit";
import type {
	MessStagingRepositoryPort,
	StagedAnnouncementMessage,
} from "../../../core/ports/MessStagingRepositoryPort";
import type { TextAnnouncementExtractionPort } from "../../../core/ports/TextAnnouncementExtractionPort";
import type { MealSwapResolver } from "../../../core/services/MealSwapResolver";
import { ExtractedCompositeAnnouncementSchema } from "../../common/mess/ExtractionSchemas";
import type { InteractiveJsonEditor } from "./InteractiveJsonEditor";
import type { CliIo } from "./TriageIo";
import type { TriageTerminalView } from "./TriageTerminalView";
type MissingSwap = StagedMealSwap & { missingReason: "source" | "target" };

/** Drives manual composite extraction, editing, prerequisite review, and confirmation. */
export class TriageAnnouncementController {
	/** All external operations and strict swap resolution are injected. */
	constructor(
		private readonly io: CliIo,
		private readonly view: TriageTerminalView,
		private readonly staging: MessStagingRepositoryPort,
		private readonly extractor: TextAnnouncementExtractionPort,
		private readonly editor: InteractiveJsonEditor,
		private readonly resolver: MealSwapResolver,
	) {}
	/** Retries extraction on request; review/commit failures propagate without model retry. */
	async run(message: StagedAnnouncementMessage): Promise<void> {
		while (true) {
			let composite;
			try {
				this.io.print("\n⏳ Extracting announcement events via DeepSeek engine...");
				composite = ExtractedCompositeAnnouncementSchema.parse(
					await this.extractor.extractAnnouncementEvents(
						message.textBody ?? "",
						message.receivedAt,
					),
				);
			} catch (error: unknown) {
				if (await this.shouldRetryExtraction(error, message.id)) continue;
				return;
			}
			await this.review(message.id, composite);
			return;
		}
	}

	private async shouldRetryExtraction(error: unknown, messageId: string): Promise<boolean> {
		this.io.print(this.view.renderExtractionErrorCard(error, messageId));
		const choice = await this.io.prompt("Choice [r/c]: ");
		return choice.toLowerCase() === "r";
	}

	private async review(id: string, composite: StagedCompositeAnnouncement): Promise<void> {
		while (true) {
			const { resolvedSwaps, missingSwaps } = await this.resolve(composite.mealSwaps ?? []);
			this.io.print(
				this.view.renderCompositeAnnouncementCard(composite, resolvedSwaps, missingSwaps),
			);
			const promptText = missingSwaps.length ? "Choice [e/c]: " : "Choice [y/e/c]: ";
			const choice = (await this.io.prompt(promptText)).toLowerCase();
			if (choice === "c") {
				this.io.print("Cancelled commit.");
				return;
			}
			if (choice === "e") {
				composite = await this.edit(composite);
				continue;
			}
			if (choice === "y") {
				const committed = await this.commitIfValid(id, composite, resolvedSwaps, missingSwaps);
				if (committed) return;
				continue;
			}
			this.io.print("Invalid choice.");
		}
	}

	private async commitIfValid(
		id: string,
		composite: StagedCompositeAnnouncement,
		resolvedSwaps: ResolvedMealSwapInput[],
		missingSwaps: readonly MissingSwap[],
	): Promise<boolean> {
		if (missingSwaps.length) {
			this.io.print("❌ Cannot Commit Swap: referenced menu not found in database.");
			return false;
		}
		await this.staging.atomicCommitComposite({ messageId: id, composite, resolvedSwaps });
		this.io.print("✅ Successfully committed announcement events to database!");
		return true;
	}
	private async edit(composite: StagedCompositeAnnouncement): Promise<StagedCompositeAnnouncement> {
		const result = await this.editor.editJson(
			structuredClone(composite),
			ExtractedCompositeAnnouncementSchema,
		);
		if (result.success && result.data) {
			this.io.print("Successfully updated announcement events from editor.");
			return result.data;
		}
		this.io.print(result.cancelled ? "Edit cancelled." : `Edit error: ${result.error}`);
		return composite;
	}
	private async resolve(swaps: readonly StagedMealSwap[]) {
		const resolvedSwaps: ResolvedMealSwapInput[] = [];
		const missingSwaps: MissingSwap[] = [];
		for (const swap of swaps) {
			const sources = await this.staging.getMealsByDateAndSlot(
				swap.sourceMealDate,
				swap.sourceMealSlot,
				swap.targetVendor ?? undefined,
			);
			if (!sources.length) {
				missingSwaps.push({ ...swap, missingReason: "source" });
				continue;
			}
			const requests = sources.map((row) => ({
				...swap,
				targetVendor: row.vendor as ResolvedMealSwapInput["vendor"],
			}));
			const result = await this.resolver.resolve(requests);
			if (result.ok) resolvedSwaps.push(...result.value);
			else
				missingSwaps.push({
					...swap,
					missingReason: result.detail.includes(`${swap.targetMealDate}/${swap.targetMealSlot}/`)
						? "target"
						: "source",
				});
		}
		return { resolvedSwaps, missingSwaps };
	}
}
