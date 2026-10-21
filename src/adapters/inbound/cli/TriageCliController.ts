import readline from 'node:readline';
import {
  PostgresMessStagingRepository,
  type ResolvedMealSwapInput,
} from '../../outbound/mess/postgres/PostgresMessStagingRepository.js';
import { DeepseekVisionExtractor } from '../../outbound/mess/extraction/DeepseekVisionExtractor.js';
import { DeepseekTextExtractor } from '../../outbound/mess/extraction/DeepseekTextExtractor.js';
import { PdfRasterizer } from '../../outbound/mess/extraction/PdfRasterizer.js';
import {
  ExtractedWeeklyMenuSchema,
  ExtractedCompositeAnnouncementSchema,
  type ExtractedWeeklyMenu,
  type ExtractedWeeklyMealItem,
  type ExtractedMealSwap,
  type ExtractedCompositeAnnouncement,
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

        // Display the Message Inspection Card so operator can preview full text and metadata
        this.io.print(this.terminalView.renderInspectionCard(selectedMessage));

        const isMedia = Boolean(
          selectedMessage.mediaMimeType ||
          selectedMessage.mediaBuffer ||
          selectedMessage.messageType !== 'text'
        );

        if (!isMedia) {
          // Streamlined Text Announcement Menu: Spec 5.1
          this.io.print('\nSelect action:');
          this.io.print('  [1] Process Announcement (Auto-Extract All Events)');
          this.io.print('  [2] Ignore Message');
          this.io.print('  [c] Cancel / Back to List');

          const intentChoice = (await this.io.prompt('Choice [1/2/c]: ')).toLowerCase();

          if (intentChoice === 'c') {
            continue;
          }

          if (intentChoice === '2') {
            // Mark Ignored
            this.io.print(this.terminalView.renderIgnorePreview(selectedMessage));
            const ignoreConfirm = (await this.io.prompt('Choice [y/c]: ')).toLowerCase();
            if (ignoreConfirm === 'y') {
              await this.stagingRepo.markIgnored(selectedMessage.id);
              this.io.print(`Message ${selectedMessage.id} marked as ignored.`);
            }
            continue;
          }

          if (intentChoice === '1') {
            await this.handleCompositeExtraction(selectedMessage);
            continue;
          }

          this.io.print('Invalid choice.');
          continue;
        } else {
          // Streamlined Media Announcement Menu: Spec 5.1
          let exitMediaMenu = false;
          while (!exitMediaMenu) {
            this.io.print('\nSelect action:');
            this.io.print('  [1] Extract Weekly Menu');
            this.io.print('  [2] Process Announcement (Auto-Extract All Events)');
            this.io.print('  [3] Open in Viewer');
            this.io.print('  [4] Ignore Message');
            this.io.print('  [c] Cancel / Back to List');

            const intentChoice = (await this.io.prompt('Choice [1-4/c]: ')).toLowerCase();

            if (intentChoice === 'c') {
              break;
            }

            if (intentChoice === '4' || intentChoice === '5') {
              // Mark Ignored
              this.io.print(this.terminalView.renderIgnorePreview(selectedMessage));
              const ignoreConfirm = (await this.io.prompt('Choice [y/c]: ')).toLowerCase();
              if (ignoreConfirm === 'y') {
                await this.stagingRepo.markIgnored(selectedMessage.id);
                this.io.print(`Message ${selectedMessage.id} marked as ignored.`);
              }
              break;
            }

            if (intentChoice === '3') {
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
              continue;
            }

            if (intentChoice === '2') {
              await this.handleCompositeExtraction(selectedMessage);
              break;
            }

            if (intentChoice === '1') {
              // Mandatory Pre-Extraction Inspection & Confirmation
              let proceed = false;
              while (true) {
                this.io.print(
                  this.terminalView.renderInspectionCard(selectedMessage, 'Weekly Menu', '1')
                );
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
                break;
              }

              await this.handleWeeklyMenuExtraction(selectedMessage);
              break;
            }

            this.io.print('Invalid choice.');
          }
          continue;
        }
      }
    } finally {
      this.close();
    }
  }

  /**
   * Executes weekly menu extraction and remediation review.
   */
  private async handleWeeklyMenuExtraction(
    message: WhatsappGroupFoodAnnouncementsMessageRow
  ): Promise<void> {
    const runExtraction = async (): Promise<ExtractedWeeklyMenu> => {
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
    };

    let menu: ExtractedWeeklyMenu | null = null;
    while (true) {
      try {
        this.io.print('\n⏳ Extracting weekly menu via DeepSeek vision engine...');
        menu = await runExtraction();
        break;
      } catch (err: any) {
        this.io.print(this.terminalView.renderExtractionErrorCard(err, message.id));
        const retryChoice = (await this.io.prompt('Choice [r/c]: ')).toLowerCase();
        if (retryChoice === 'r') {
          continue;
        } else {
          return;
        }
      }
    }

    if (menu) {
      await this.reviewWeeklyMenu(message, menu);
    }
  }

  /**
   * Executes composite announcement extraction and remediation review.
   */
  private async handleCompositeExtraction(
    message: WhatsappGroupFoodAnnouncementsMessageRow
  ): Promise<void> {
    let composite: ExtractedCompositeAnnouncement | null = null;
    while (true) {
      try {
        this.io.print('\n⏳ Extracting announcement events via DeepSeek engine...');
        composite = await this.textExtractor.extractAnnouncementEvents(
          message.textBody ?? '',
          message.receivedAt
        );
        break;
      } catch (err: any) {
        this.io.print(this.terminalView.renderExtractionErrorCard(err, message.id));
        const retryChoice = (await this.io.prompt('Choice [r/c]: ')).toLowerCase();
        if (retryChoice === 'r') {
          continue;
        } else {
          return;
        }
      }
    }

    if (composite) {
      await this.reviewCompositeAnnouncement(message, composite);
    }
  }

  /**
   * Reviews composite announcement preview, verifies meal swaps against DB (Option B gate),
   * provides Neovim JSON editing, and atomically commits.
   */
  private async reviewCompositeAnnouncement(
    message: WhatsappGroupFoodAnnouncementsMessageRow,
    composite: ExtractedCompositeAnnouncement
  ): Promise<void> {
    let currentComposite = composite;

    while (true) {
      const { resolvedSwaps, missingSwaps } = await this.resolveSwaps(currentComposite.mealSwaps);

      this.io.print(
        this.terminalView.renderCompositeAnnouncementCard(
          currentComposite,
          resolvedSwaps,
          missingSwaps
        )
      );

      const hasMissingSwaps = missingSwaps.length > 0;
      const promptStr = hasMissingSwaps ? 'Choice [e/c]: ' : 'Choice [y/e/c]: ';
      const choice = (await this.io.prompt(promptStr)).toLowerCase();

      if (choice === 'y') {
        if (hasMissingSwaps) {
          const firstMissing = missingSwaps[0];
          const isTarget = (firstMissing as any).missingReason === 'target';
          const dateStr = isTarget ? firstMissing.targetMealDate : firstMissing.sourceMealDate;
          const slotStr = isTarget ? firstMissing.targetMealSlot : firstMissing.sourceMealSlot;
          const menuType = isTarget ? 'Target' : 'Source';
          this.io.print(
            `❌ Cannot Commit Swap: ${menuType} menu for ${dateStr} ${slotStr} not found in database. Please ingest that date's weekly menu before committing this announcement.`
          );
          continue;
        }

        await this.stagingRepo.atomicCommitComposite({
          messageId: message.id,
          composite: currentComposite,
          resolvedSwaps,
        });
        this.io.print('✅ Successfully committed announcement events to database!');
        break;
      } else if (choice === 'e') {
        const editRes = await this.editor.editJson(
          currentComposite,
          ExtractedCompositeAnnouncementSchema
        );
        if (editRes.success && editRes.data) {
          currentComposite = editRes.data;
          this.io.print('Successfully updated announcement events from editor.');
        } else if (editRes.cancelled) {
          this.io.print('Edit cancelled.');
        } else if (editRes.error) {
          this.io.print(`Edit error: ${editRes.error}`);
        }
      } else if (choice === 'c') {
        this.io.print('Cancelled commit.');
        break;
      } else {
        this.io.print('Invalid choice.');
      }
    }
  }

  /**
   * Option B Pre-Commit Verification Gate:
   * Inspects database for (sourceMealDate, sourceMealSlot).
   * Populates resolvedSwaps with backup of current target meal items if found;
   * otherwise populates missingSwaps to block commitment.
   */
  private async resolveSwaps(
    mealSwaps?: ExtractedMealSwap[]
  ): Promise<{ resolvedSwaps: ResolvedMealSwapInput[]; missingSwaps: ExtractedMealSwap[] }> {
    const resolvedSwaps: ResolvedMealSwapInput[] = [];
    const missingSwaps: ExtractedMealSwap[] = [];

    if (!mealSwaps || mealSwaps.length === 0) {
      return { resolvedSwaps, missingSwaps };
    }

    for (const swap of mealSwaps) {
      const sourceMeals = await this.stagingRepo.getMealsByDateAndSlot(
        swap.sourceMealDate,
        swap.sourceMealSlot,
        swap.targetVendor ?? undefined
      );

      if (!sourceMeals || sourceMeals.length === 0) {
        missingSwaps.push({ ...swap, missingReason: 'source' } as any);
        continue;
      }

      let missingTarget = false;
      const currentResolved: ResolvedMealSwapInput[] = [];

      for (const sourceMeal of sourceMeals) {
        const targetMeals = await this.stagingRepo.getMealsByDateAndSlot(
          swap.targetMealDate,
          swap.targetMealSlot,
          sourceMeal.vendor
        );

        if (!targetMeals || targetMeals.length === 0) {
          missingTarget = true;
          break;
        }

        currentResolved.push({
          targetMealDate: swap.targetMealDate,
          targetMealSlot: swap.targetMealSlot as any,
          vendor: sourceMeal.vendor as any,
          newItems: sourceMeal.items,
          previousItems: targetMeals[0].items,
          sourceMealDate: swap.sourceMealDate,
          sourceMealSlot: swap.sourceMealSlot as any,
        });
      }

      if (missingTarget) {
        missingSwaps.push({ ...swap, missingReason: 'target' } as any);
      } else {
        resolvedSwaps.push(...currentResolved);
      }
    }

    return { resolvedSwaps, missingSwaps };
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
}
