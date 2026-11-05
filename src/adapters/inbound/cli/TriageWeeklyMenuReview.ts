import type {
	MenuCorrection,
	MenuExtractionResult,
	StagedWeeklyMenu,
} from "../../../core/entities/MessAnnouncement";
import type {
	MessStagingRepositoryPort,
	StagedAnnouncementMessage,
} from "../../../core/ports/MessStagingRepositoryPort";
import type { MenuDishNormalizer } from "../../../core/services/MenuDishNormalizer";
import { daysBetweenISODates, isValidISODate, shiftISODate } from "../../../core/utils/Temporal";
import { ExtractedWeeklyMenuSchema } from "../../common/mess/ExtractionSchemas";
import type { InteractiveJsonEditor } from "./InteractiveJsonEditor";
import type { CliIo } from "./TriageIo";
import type { TriageTerminalView } from "./TriageTerminalView";

/** Reviews working menus while preserving extraction and chronological correction evidence. */
export class TriageWeeklyMenuReview {
	/** Injects operator I/O, editing, staging writes, and approved normalization. */
	constructor(
		private readonly io: CliIo,
		private readonly view: TriageTerminalView,
		private readonly staging: MessStagingRepositoryPort,
		private readonly editor: InteractiveJsonEditor,
		private readonly normalizer: typeof MenuDishNormalizer,
	) {}
	/** Confirms the normalized final menu; cancellation writes nothing; persistence failures reject. */
	async run(message: StagedAnnouncementMessage, extraction: MenuExtractionResult): Promise<void> {
		const evidence = structuredClone(extraction);
		let working = structuredClone(evidence.menu);
		const reviewCorrections: MenuCorrection[] = [];
		while (true) {
			const normalized = this.normalizer.normalize(working);
			this.io.print(this.view.renderWeeklyMenuPreview(normalized.menu));
			this.io.print(
				this.view.renderMenuCorrections([...evidence.corrections, ...reviewCorrections]),
			);
			const choice = (await this.io.prompt("Choice [y/v/d/e/c]: ")).toLowerCase();
			if (choice === "c") {
				this.io.print("Cancelled commit.");
				return;
			}
			if (choice === "y") {
				await this.staging.atomicCommit({
					messageId: message.id,
					weeklyMenu: normalized.menu,
					extractionAudit: {
						...structuredClone(evidence),
						reviewedMenu: structuredClone(working),
						reviewCorrections: structuredClone(reviewCorrections),
					},
				});
				this.io.print("✅ Successfully committed weekly menu to database!");
				return;
			}
			if (choice === "v") await this.vendor(working);
			if (choice === "d") await this.dates(working);
			if (choice === "e") {
				const edited = await this.edit(working);
				if (edited !== working)
					reviewCorrections.push(...this.normalizer.normalize(edited).corrections);
				working = edited;
			}
		}
	}
	private async vendor(menu: StagedWeeklyMenu): Promise<void> {
		const choice = await this.io.prompt(
			`Switch Vendor (current: ${menu.vendor} ➔ [1] regular, [2] jain, [3] tcb): `,
		);
		const vendor = ({ "1": "cheftalk_regular", "2": "cheftalk_jain", "3": "tcb" } as const)[
			choice as "1" | "2" | "3"
		];
		if (vendor) menu.vendor = vendor;
		else this.io.print("Invalid vendor choice.");
	}
	private async dates(menu: StagedWeeklyMenu): Promise<void> {
		const start = await this.io.prompt("Enter new start date (YYYY-MM-DD): ");
		if (!isValidISODate(start)) {
			this.io.print("Invalid date format. Expected YYYY-MM-DD.");
			return;
		}
		const old = [...menu.meals.map((meal) => meal.mealDate)].sort()[0];
		if (!old) return;
		const offset = daysBetweenISODates(old, start);
		menu.meals = menu.meals.map((meal) => ({
			...meal,
			mealDate: shiftISODate(meal.mealDate, offset),
		}));
	}
	private async edit(menu: StagedWeeklyMenu): Promise<StagedWeeklyMenu> {
		const result = await this.editor.editJson(
			this.normalizer.normalize(menu).menu,
			ExtractedWeeklyMenuSchema,
		);
		if (result.success && result.data) {
			this.io.print("Successfully updated weekly menu from editor.");
			return structuredClone(result.data);
		}
		this.io.print(result.cancelled ? "Edit cancelled." : `Edit error: ${result.error}`);
		return menu;
	}
}
