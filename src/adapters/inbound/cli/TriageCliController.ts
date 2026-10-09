import readline from 'node:readline';
import { PostgresMessStagingRepository } from '../../outbound/mess/postgres/PostgresMessStagingRepository.js';
import { DeepseekVisionExtractor } from '../../outbound/mess/extraction/DeepseekVisionExtractor.js';
import { DeepseekTextExtractor } from '../../outbound/mess/extraction/DeepseekTextExtractor.js';
import { PdfRasterizer } from '../../outbound/mess/extraction/PdfRasterizer.js';
import {
  ExtractedWeeklyMenuSchema,
  ExtractedLocationDetailSchema,
  type ExtractedWeeklyMenu,
  type ExtractedWeeklyMealItem,
  type ExtractedLocationDetail,
  type ExtractedTimingExtension,
  type ExtractedMealChange,
} from '../../outbound/mess/extraction/ExtractionSchemas.js';
import { InteractiveJsonEditor } from './InteractiveJsonEditor.js';
import { MediaPreviewer } from './MediaPreviewer.js';
import { TriageTerminalView } from './TriageTerminalView.js';
import type { WhatsappGroupFoodAnnouncementsMessageRow } from '../../outbound/mess/postgres/schema.js';

export interface CliIo {
  prompt(question: string): Promise<string>;
  print(message: string): void;
  close?(): void;
}

class DefaultCliIo implements CliIo {
  private rl: readline.Interface | null = null;

  private getRl(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    return this.rl;
  }

  async prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.getRl().question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  print(message: string): void {
    console.log(message);
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

export interface TriageCliControllerDependencies {
  stagingRepo: PostgresMessStagingRepository;
  visionExtractor: DeepseekVisionExtractor;
  textExtractor: DeepseekTextExtractor;
  pdfRasterizer?: PdfRasterizer;
  editor?: InteractiveJsonEditor;
  previewer?: MediaPreviewer;
  terminalView?: TriageTerminalView;
  io?: CliIo;
}

export interface RunTriageOptions {
  limit?: number;
  date?: string;
}

/**
 * Shifts all dates in an extracted 21-meal weekly menu by calculating the difference
 * between the new start date and the existing minimum date.
 */
export function shiftWeeklyMenuDates(
  meals: ExtractedWeeklyMealItem[],
  newStartDate: string
): ExtractedWeeklyMealItem[] {
  if (meals.length === 0) return meals;
  const sortedDates = [...meals.map((m) => m.mealDate)].sort();
  const oldStart = sortedDates[0];
  const oldMs = Date.parse(`${oldStart}T00:00:00Z`);
  const newMs = Date.parse(`${newStartDate}T00:00:00Z`);
  const diffMs = newMs - oldMs;

  return meals.map((m) => {
    const curMs = Date.parse(`${m.mealDate}T00:00:00Z`);
    const newDate = new Date(curMs + diffMs);
    return {
      ...m,
      mealDate: newDate.toISOString().slice(0, 10),
    };
  });
}

export class TriageCliController {
  private readonly stagingRepo: PostgresMessStagingRepository;
  private readonly visionExtractor: DeepseekVisionExtractor;
  private readonly textExtractor: DeepseekTextExtractor;
  private readonly pdfRasterizer: PdfRasterizer;
  private readonly editor: InteractiveJsonEditor;
  private readonly previewer: MediaPreviewer;
  private readonly terminalView: TriageTerminalView;
  private readonly io: CliIo;

  constructor(deps: TriageCliControllerDependencies) {
    this.stagingRepo = deps.stagingRepo;
    this.visionExtractor = deps.visionExtractor;
    this.textExtractor = deps.textExtractor;
    this.pdfRasterizer = deps.pdfRasterizer ?? new PdfRasterizer();
    this.io = deps.io ?? new DefaultCliIo();
    this.previewer = deps.previewer ?? new MediaPreviewer();
    this.terminalView = deps.terminalView ?? new TriageTerminalView();
    this.editor =
      deps.editor ??
      new InteractiveJsonEditor({
        promptRetry: async (errorMessage: string) => {
          const ans = await this.io.prompt(
            `\nInvalid JSON or schema mismatch: ${errorMessage}\n[r] Retry editing / [c] Cancel: `
          );
          return ans.toLowerCase() === 'r';
        },
      });
  }

  /**
   * Closes the underlying IO interface (e.g. readline) cleanly.
   */
  close(): void {
    this.io.close?.();
  }

  /**
   * Main interactive triage event loop.
   */
  async run(options?: RunTriageOptions): Promise<void> {
    const limit = options?.limit ?? 10;
    const date = options?.date;

    try {
      while (true) {
        const messages = await this.stagingRepo.listStagedMessages({
          limit,
          date,
        });

        if (messages.length === 0) {
          this.io.print(this.terminalView.renderMessagesTable([]));
          this.io.print('No staged food announcement messages found.');
          return;
        }

        this.io.print(this.terminalView.renderMessagesTable(messages));

      const selectionInput = await this.io.prompt(
        `Select message [1-${messages.length}] or [q] to quit: `
      );

      if (selectionInput.toLowerCase() === 'q' || selectionInput.toLowerCase() === 'quit') {
        break;
      }

      const selectedIdx = parseInt(selectionInput, 10);
      if (isNaN(selectedIdx) || selectedIdx < 1 || selectedIdx > messages.length) {
        this.io.print('Invalid selection index. Please enter a valid number or [q] to quit.');
        continue;
      }

      const selectedMessage = messages[selectedIdx - 1];

      // If message is already processed, display processed rollback card
      if (selectedMessage.status === 'processed') {
        this.io.print(this.terminalView.renderProcessedMessageCard(selectedMessage));
        const rollbackChoice = (await this.io.prompt('Choice [u/c]: ')).toLowerCase();
        if (rollbackChoice === 'u') {
          await this.stagingRepo.atomicUndo(selectedMessage.id);
          this.io.print('Surgically reverted message ingestion. Status reset to pending.');
        }
        continue;
      }

      // Prompt Intent Action
      this.io.print('\nSelect Intent Action:');
      this.io.print('  [1] Weekly Menu');
      this.io.print('  [2] Location Detail');
      this.io.print('  [3] Timing Extension');
      this.io.print('  [4] Meal Change');
      this.io.print('  [5] Mark Ignored');
      this.io.print('  [c] Cancel / Back to List');

      const intentChoice = (await this.io.prompt('Choice [1-5/c]: ')).toLowerCase();

      if (intentChoice === 'c') {
        continue;
      }

      if (intentChoice === '5') {
        // Mark Ignored
        this.io.print(this.terminalView.renderIgnorePreview(selectedMessage));
        const ignoreConfirm = (await this.io.prompt('Choice [y/c]: ')).toLowerCase();
        if (ignoreConfirm === 'y') {
          await this.stagingRepo.markIgnored(selectedMessage.id);
          this.io.print(`Message ${selectedMessage.id} marked as ignored.`);
        }
        continue;
      }

      const intentMap: Record<string, string> = {
        '1': 'Weekly Menu',
        '2': 'Location Detail',
        '3': 'Timing Extension',
        '4': 'Meal Change',
      };

      const intentName = intentMap[intentChoice];
      if (!intentName) {
        this.io.print('Invalid intent action selected.');
        continue;
      }

      // Mandatory Pre-Extraction Inspection & Confirmation
      let proceed = false;
      while (true) {
        this.io.print(this.terminalView.renderInspectionCard(selectedMessage, intentName, intentChoice));
        const inspChoice = (await this.io.prompt('Choice [y/o/c]: ')).toLowerCase();

        if (inspChoice === 'c') {
          break;
        } else if (inspChoice === 'o') {
          if (selectedMessage.mediaBuffer && selectedMessage.mediaMimeType) {
            const previewRes = await this.previewer.previewMedia(
              selectedMessage.mediaBuffer,
              selectedMessage.mediaMimeType,
              selectedMessage.textBody ?? undefined
            );
            if (previewRes.success) {
              this.io.print(`Media opened in native viewer: ${previewRes.filePath}`);
            } else {
              this.io.print(`Failed to launch viewer: ${previewRes.error}`);
            }
          } else {
            this.io.print('No binary media attached to this message.');
          }
        } else if (inspChoice === 'y') {
          proceed = true;
          break;
        }
      }

      if (!proceed) {
        continue;
      }

        // Execute Extraction with Non-Fatal Error Recovery
        await this.handleExtractionAndReview(selectedMessage, intentChoice);
      }
    } finally {
      this.close();
    }
  }

  /**
   * Executes the respective extraction engine and reviews / remediates the result.
   */
  private async handleExtractionAndReview(
    message: WhatsappGroupFoodAnnouncementsMessageRow,
    intentChoice: string
  ): Promise<void> {
    const runExtraction = async (): Promise<any> => {
      if (intentChoice === '1') {
        // Weekly Menu
        const isPdf =
          message.mediaMimeType === 'application/pdf' ||
          Boolean(message.mediaBuffer?.subarray(0, 4).toString().startsWith('%PDF'));

        if (isPdf && message.mediaBuffer) {
          const pngBuffer = await this.pdfRasterizer.rasterizePageOneToPng(message.mediaBuffer);
          return await this.visionExtractor.extractWeeklyMenu(pngBuffer, {
            mimeType: 'image/png',
            textContext: message.textBody ?? undefined,
          });
        } else if (message.mediaBuffer) {
          return await this.visionExtractor.extractWeeklyMenu(message.mediaBuffer, {
            mimeType: message.mediaMimeType ?? 'image/png',
            textContext: message.textBody ?? undefined,
          });
        } else {
          throw new Error('Weekly menu extraction requires image or PDF media attachment.');
        }
      } else if (intentChoice === '2') {
        // Location Detail
        return await this.textExtractor.extractLocationDetail(
          message.textBody ?? '',
          message.receivedAt
        );
      } else if (intentChoice === '3') {
        // Timing Extension
        return await this.textExtractor.extractTimingExtension(
          message.textBody ?? '',
          message.receivedAt
        );
      } else if (intentChoice === '4') {
        // Meal Change
        return await this.textExtractor.extractMealChange(
          message.textBody ?? '',
          message.receivedAt
        );
      }
    };

    let extractedData: any = null;
    while (true) {
      try {
        this.io.print('\n⏳ Extracting data via DeepSeek engine...');
        extractedData = await runExtraction();
        break;
      } catch (err: any) {
        this.io.print(this.terminalView.renderExtractionErrorCard(err, message.id));
        const retryChoice = (await this.io.prompt('Choice [r/c]: ')).toLowerCase();
        if (retryChoice === 'r') {
          continue;
        } else {
          return; // Abort back to list
        }
      }
    }

    // Interactive Review & Remediation by Intent
    if (intentChoice === '1') {
      await this.reviewWeeklyMenu(message, extractedData as ExtractedWeeklyMenu);
    } else if (intentChoice === '2') {
      await this.reviewLocationDetail(message, extractedData as ExtractedLocationDetail);
    } else if (intentChoice === '3') {
      await this.reviewTimingExtension(message, extractedData as ExtractedTimingExtension);
    } else if (intentChoice === '4') {
      await this.reviewMealChange(message, extractedData as ExtractedMealChange);
    }
  }

  private async reviewWeeklyMenu(
    message: WhatsappGroupFoodAnnouncementsMessageRow,
    menu: ExtractedWeeklyMenu
  ): Promise<void> {
    let currentMenu = menu;

    while (true) {
      this.io.print(this.terminalView.renderWeeklyMenuPreview(currentMenu));
      const choice = (await this.io.prompt('Choice [y/v/d/e/c]: ')).toLowerCase();

      if (choice === 'y') {
        await this.stagingRepo.atomicCommit({
          messageId: message.id,
          weeklyMenu: currentMenu,
        });
        this.io.print('✅ Successfully committed weekly menu to database!');
        break;
      } else if (choice === 'v') {
        const vChoice = await this.io.prompt(
          `Switch Vendor (current: ${currentMenu.vendor} ➔ [1] regular, [2] jain, [3] tcb): `
        );
        if (vChoice === '1') currentMenu.vendor = 'cheftalk_regular';
        else if (vChoice === '2') currentMenu.vendor = 'cheftalk_jain';
        else if (vChoice === '3') currentMenu.vendor = 'tcb';
        else this.io.print('Invalid vendor choice.');
      } else if (choice === 'd') {
        const newStartDate = await this.io.prompt('Enter new start date (YYYY-MM-DD): ');
        if (/^\d{4}-\d{2}-\d{2}$/.test(newStartDate)) {
          currentMenu.meals = shiftWeeklyMenuDates(currentMenu.meals, newStartDate);
        } else {
          this.io.print('Invalid date format. Expected YYYY-MM-DD.');
        }
      } else if (choice === 'e') {
        const editRes = await this.editor.editJson(currentMenu, ExtractedWeeklyMenuSchema);
        if (editRes.success && editRes.data) {
          currentMenu = editRes.data;
          this.io.print('Successfully updated weekly menu from editor.');
        } else if (editRes.cancelled) {
          this.io.print('Edit cancelled.');
        } else if (editRes.error) {
          this.io.print(`Edit error: ${editRes.error}`);
        }
      } else if (choice === 'c') {
        this.io.print('Cancelled commit.');
        break;
      }
    }
  }

  private async reviewLocationDetail(
    message: WhatsappGroupFoodAnnouncementsMessageRow,
    detail: ExtractedLocationDetail
  ): Promise<void> {
    let currentDetail = detail;

    while (true) {
      this.io.print(this.terminalView.renderLocationDetailPreview(currentDetail, message));
      const choice = (await this.io.prompt('Choice [y/d/e/c]: ')).toLowerCase();

      if (choice === 'y') {
        await this.stagingRepo.atomicCommit({
          messageId: message.id,
          locationDetail: currentDetail,
        });
        this.io.print('✅ Successfully committed location seating details!');
        break;
      } else if (choice === 'd') {
        const newDate = await this.io.prompt(
          `Enter new meal date (current: ${currentDetail.mealDate}, YYYY-MM-DD): `
        );
        if (/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
          currentDetail.mealDate = newDate;
        } else {
          this.io.print('Invalid date format. Expected YYYY-MM-DD.');
        }
      } else if (choice === 'e') {
        const editRes = await this.editor.editJson(currentDetail, ExtractedLocationDetailSchema);
        if (editRes.success && editRes.data) {
          currentDetail = editRes.data;
          this.io.print('Successfully updated location detail from editor.');
        } else if (editRes.cancelled) {
          this.io.print('Edit cancelled.');
        } else if (editRes.error) {
          this.io.print(`Edit error: ${editRes.error}`);
        }
      } else if (choice === 'c') {
        this.io.print('Cancelled commit.');
        break;
      }
    }
  }

  private async reviewTimingExtension(
    message: WhatsappGroupFoodAnnouncementsMessageRow,
    timing: ExtractedTimingExtension
  ): Promise<void> {
    const currentTiming = timing;

    while (true) {
      this.io.print(this.terminalView.renderTimingExtensionPreview(currentTiming, message));
      const choice = (await this.io.prompt('Choice [y/v/c]: ')).toLowerCase();

      if (choice === 'y') {
        await this.stagingRepo.atomicCommit({
          messageId: message.id,
          timingExtension: currentTiming,
        });
        this.io.print('✅ Successfully committed timing extension!');
        break;
      } else if (choice === 'v') {
        const vChoice = await this.io.prompt(
          'Assign to specific vendor: [0] ALL, [1] regular, [2] jain, [3] tcb: '
        );
        if (vChoice === '0') currentTiming.targetVendor = null;
        else if (vChoice === '1') currentTiming.targetVendor = 'cheftalk_regular';
        else if (vChoice === '2') currentTiming.targetVendor = 'cheftalk_jain';
        else if (vChoice === '3') currentTiming.targetVendor = 'tcb';
        else this.io.print('Invalid vendor choice.');
      } else if (choice === 'c') {
        this.io.print('Cancelled commit.');
        break;
      }
    }
  }

  private async reviewMealChange(
    message: WhatsappGroupFoodAnnouncementsMessageRow,
    change: ExtractedMealChange
  ): Promise<void> {
    const currentChange = change;

    while (true) {
      this.io.print(this.terminalView.renderMealChangePreview(currentChange, message));
      const choice = (await this.io.prompt('Choice [y/t/c]: ')).toLowerCase();

      if (choice === 'y') {
        await this.stagingRepo.atomicCommit({
          messageId: message.id,
          mealChange: currentChange,
        });
        this.io.print('✅ Successfully committed meal change!');
        break;
      } else if (choice === 't') {
        const tChoice = await this.io.prompt(
          `Change Type (current: ${currentChange.changeType} ➔ [1] replacement, [2] addition, [3] cancellation): `
        );
        if (tChoice === '1') currentChange.changeType = 'replacement';
        else if (tChoice === '2') currentChange.changeType = 'addition';
        else if (tChoice === '3') currentChange.changeType = 'cancellation';
        else this.io.print('Invalid change type choice.');
      } else if (choice === 'c') {
        this.io.print('Cancelled commit.');
        break;
      }
    }
  }
}
