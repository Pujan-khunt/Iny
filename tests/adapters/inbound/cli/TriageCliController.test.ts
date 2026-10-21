import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriageCliController } from '../../../../src/adapters/inbound/cli/TriageCliController.js';
import type { WhatsappGroupFoodAnnouncementsMessageRow } from '../../../../src/adapters/outbound/mess/postgres/schema.js';
import type {
  ExtractedWeeklyMenu,
  ExtractedLocationDetail,
  ExtractedTimingExtension,
  ExtractedMealChange,
  ExtractedCompositeAnnouncement,
} from '../../../../src/adapters/outbound/mess/extraction/ExtractionSchemas.js';
import { ExtractedCompositeAnnouncementSchema } from '../../../../src/adapters/outbound/mess/extraction/ExtractionSchemas.js';

class MockIo {
  private inputs: string[];
  public outputs: string[] = [];
  public isClosed = false;

  constructor(inputs: string[] = []) {
    this.inputs = [...inputs];
  }

  async prompt(_question: string): Promise<string> {
    const val = this.inputs.shift();
    if (val === undefined) {
      throw new Error(`MockIo ran out of inputs! Question was: ${_question}`);
    }
    return val;
  }

  print(msg: string): void {
    this.outputs.push(msg);
  }

  close(): void {
    this.isClosed = true;
  }
}

describe('TriageCliController', () => {
  let mockStagingRepo: any;
  let mockVisionExtractor: any;
  let mockTextExtractor: any;
  let mockPdfRasterizer: any;
  let mockEditor: any;
  let mockPreviewer: any;

  const mockWeeklyMenu: ExtractedWeeklyMenu = {
    vendor: 'cheftalk_regular',
    meals: Array.from({ length: 21 }, (_, i) => ({
      mealDate: `2026-10-${String(4 + Math.floor(i / 3)).padStart(2, '0')}`,
      mealSlot: (['breakfast', 'lunch', 'dinner'] as const)[i % 3],
      items: [`Item ${i + 1}`],
    })),
  };

  const samplePendingPdfMessage: WhatsappGroupFoodAnnouncementsMessageRow = {
    id: 'MSG_PDF_01',
    senderAddress: '+919876543210',
    senderAddressType: 'pn',
    messageType: 'document',
    mediaMimeType: 'application/pdf',
    mediaBuffer: Buffer.from('%PDF-1.4 test'),
    textBody: 'Weekly menu Oct 4-10.pdf',
    status: 'pending',
    receivedAt: new Date('2026-10-08T06:00:00Z'),
    processedAt: null,
  };

  const sampleProcessedMessage: WhatsappGroupFoodAnnouncementsMessageRow = {
    id: 'MSG_PROCESSED_01',
    senderAddress: '+919876543210',
    senderAddressType: 'pn',
    messageType: 'text',
    mediaMimeType: null,
    mediaBuffer: null,
    textBody: 'Lunch today in hostel mess',
    status: 'processed',
    receivedAt: new Date('2026-10-08T06:00:00Z'),
    processedAt: new Date('2026-10-08T07:00:00Z'),
  };

  beforeEach(() => {
    mockStagingRepo = {
      listStagedMessages: vi.fn(),
      getMessageById: vi.fn(),
      atomicCommit: vi.fn().mockResolvedValue(undefined),
      atomicCommitComposite: vi.fn().mockResolvedValue(undefined),
      markIgnored: vi.fn().mockResolvedValue(undefined),
      atomicUndo: vi.fn().mockResolvedValue(undefined),
      getMealsByDateAndSlot: vi.fn().mockResolvedValue([]),
    };

    mockVisionExtractor = {
      extractWeeklyMenu: vi.fn().mockResolvedValue(mockWeeklyMenu),
    };

    mockTextExtractor = {
      extractLocationDetail: vi.fn(),
      extractTimingExtension: vi.fn(),
      extractMealChange: vi.fn(),
      extractAnnouncementEvents: vi.fn(),
    };

    mockPdfRasterizer = {
      rasterizePageOneToPng: vi.fn().mockResolvedValue(Buffer.from('png-bytes')),
    };

    mockEditor = {
      editJson: vi.fn(),
    };

    mockPreviewer = {
      previewMedia: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/test.pdf' }),
    };
  });

  it('exits gracefully when user selects [q]', async () => {
    mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);
    const io = new MockIo(['q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      pdfRasterizer: mockPdfRasterizer,
      editor: mockEditor,
      previewer: mockPreviewer,
      io,
    });

    await controller.run();
    expect(mockStagingRepo.listStagedMessages).toHaveBeenCalledTimes(1);
  });

  it('prints notice when no staged messages are found', async () => {
    mockStagingRepo.listStagedMessages.mockResolvedValue([]);
    const io = new MockIo([]);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();
    expect(io.outputs.some((o) => o.includes('No staged food announcement messages found'))).toBe(true);
  });

  it('handles processed message undo action [u]', async () => {
    mockStagingRepo.listStagedMessages
      .mockResolvedValueOnce([sampleProcessedMessage])
      .mockResolvedValueOnce([]); // next loop returns empty and exits

    // Choices: select message 1 -> undo 'u' -> will loop, then exit on q or empty
    const io = new MockIo(['1', 'u', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();
    expect(mockStagingRepo.atomicUndo).toHaveBeenCalledWith('MSG_PROCESSED_01');
  });

  it('handles pending message mark ignored [5] -> [y]', async () => {
    mockStagingRepo.listStagedMessages
      .mockResolvedValueOnce([samplePendingPdfMessage])
      .mockResolvedValueOnce([]);

    // Select message 1 -> Intent 5 (mark ignored) -> confirm 'y' -> exit 'q'
    const io = new MockIo(['1', '5', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();
    expect(mockStagingRepo.markIgnored).toHaveBeenCalledWith('MSG_PDF_01');
  });

  it('inspects media preview [o] before proceeding with extraction', async () => {
    mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);

    // Select 1 -> Intent 1 -> Choice 'o' (open media) -> Choice 'c' (cancel) -> Exit 'q'
    const io = new MockIo(['1', '1', 'o', 'c', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      previewer: mockPreviewer,
      io,
    });

    await controller.run();
    expect(mockPreviewer.previewMedia).toHaveBeenCalledWith(
      samplePendingPdfMessage.mediaBuffer,
      samplePendingPdfMessage.mediaMimeType,
      samplePendingPdfMessage.textBody
    );
  });

  it('handles non-fatal extraction error card and retries with [r]', async () => {
    mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);

    // First call throws, second call succeeds
    mockPdfRasterizer.rasterizePageOneToPng
      .mockRejectedValueOnce(new Error('Rate limit reached for deepseek-flash'))
      .mockResolvedValueOnce(Buffer.from('png-bytes'));

    // Select 1 -> Intent 1 -> Proceed 'y' -> Error occurs -> Retry 'r' -> Preview shown -> Commit 'y' -> Exit 'q'
    const io = new MockIo(['1', '1', 'y', 'r', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      pdfRasterizer: mockPdfRasterizer,
      io,
    });

    await controller.run();
    expect(mockStagingRepo.atomicCommit).toHaveBeenCalledWith({
      messageId: 'MSG_PDF_01',
      weeklyMenu: mockWeeklyMenu,
    });
  });

  it('executes full weekly menu remediation (switch vendor [v], shift dates [d], edit [e], confirm [y])', async () => {
    mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);

    const updatedMenuFromEditor: ExtractedWeeklyMenu = {
      ...mockWeeklyMenu,
      vendor: 'cheftalk_jain',
    };
    mockEditor.editJson.mockResolvedValue({
      success: true,
      data: updatedMenuFromEditor,
    });

    // 1 -> Intent 1 -> 'y' (proceed) -> Preview shown:
    // 'v' -> switch to [3] (tcb)
    // 'd' -> shift start date to '2026-10-05'
    // 'e' -> edit in vim
    // 'y' -> confirm commit
    // 'q' -> exit
    const io = new MockIo(['1', '1', 'y', 'v', '3', 'd', '2026-10-05', 'e', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      pdfRasterizer: mockPdfRasterizer,
      editor: mockEditor,
      io,
    });

    await controller.run();
    expect(mockPdfRasterizer.rasterizePageOneToPng).toHaveBeenCalled();
    expect(mockVisionExtractor.extractWeeklyMenu).toHaveBeenCalled();
    expect(mockEditor.editJson).toHaveBeenCalled();
    expect(mockStagingRepo.atomicCommit).toHaveBeenCalledWith({
      messageId: 'MSG_PDF_01',
      weeklyMenu: expect.objectContaining({
        vendor: 'cheftalk_jain',
      }),
    });
  });

  it('handles pending text message mark ignored [2] -> [y]', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_TEXT_IGNORE_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: 'Some informal text message',
    };
    mockStagingRepo.listStagedMessages
      .mockResolvedValueOnce([textMsg])
      .mockResolvedValueOnce([]);

    // Select 1 -> Option 2 (Ignore Message) -> Confirm 'y' -> Exit 'q'
    const io = new MockIo(['1', '2', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();
    expect(mockStagingRepo.markIgnored).toHaveBeenCalledWith('MSG_TEXT_IGNORE_01');
  });

  it('handles media message streamlined menu choices (Open in Viewer [3], Ignore [4], Process Announcement [2])', async () => {
    const mediaMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_MEDIA_01',
      textBody: 'Lunch notice with image',
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([mediaMsg]);

    const compositePayload: ExtractedCompositeAnnouncement = {
      mealDate: '2026-10-20',
      location: null,
      timingExtensions: [],
      mealChanges: [],
      mealSwaps: [],
    };
    mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositePayload);

    // 1 -> [3] Open in Viewer -> [2] Process Announcement -> [y] Confirm -> [q]
    const io = new MockIo(['1', '3', '2', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      previewer: mockPreviewer,
      io,
    });

    await controller.run();
    expect(mockPreviewer.previewMedia).toHaveBeenCalled();
    expect(mockTextExtractor.extractAnnouncementEvents).toHaveBeenCalledWith(
      mediaMsg.textBody,
      mediaMsg.receivedAt
    );
    expect(mockStagingRepo.atomicCommitComposite).toHaveBeenCalledWith({
      messageId: 'MSG_MEDIA_01',
      composite: compositePayload,
      resolvedSwaps: [],
    });
  });

  it('handles composite text announcement extraction and commit', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_COMPOSITE_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: '2028 and 2029 in Hostel for lunch. Dinner extended till 10:30 PM.',
      receivedAt: new Date('2026-10-20T06:00:00Z'),
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

    const compositePayload: ExtractedCompositeAnnouncement = {
      mealDate: '2026-10-20',
      location: {
        mealDate: '2026-10-20',
        mealSlot: 'lunch',
        hostelBatches: ['2028', '2029'],
        collegeBatches: ['ALL_OTHER_BATCHES'],
      },
      timingExtensions: [
        {
          mealDate: '2026-10-20',
          mealSlot: 'dinner',
          targetVendor: null,
          extendedTimings: 'Dinner extended till 10:30 PM',
        },
      ],
      mealChanges: [],
      mealSwaps: [],
    };
    mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositePayload);

    // 1 (select message) -> 1 (Process Announcement) -> y (Confirm & Commit) -> q (exit)
    const io = new MockIo(['1', '1', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();

    expect(mockTextExtractor.extractAnnouncementEvents).toHaveBeenCalledWith(
      textMsg.textBody,
      textMsg.receivedAt
    );
    expect(mockStagingRepo.atomicCommitComposite).toHaveBeenCalledWith({
      messageId: 'MSG_COMPOSITE_01',
      composite: compositePayload,
      resolvedSwaps: [],
    });
  });

  it('blocks commit when swap source menu is missing (Option B gate)', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_SWAP_MISSING_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: "Today's dinner will serve tomorrow's lunch menu",
      receivedAt: new Date('2026-10-20T06:00:00Z'),
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

    const compositeWithSwap: ExtractedCompositeAnnouncement = {
      mealDate: '2026-10-20',
      location: null,
      timingExtensions: [],
      mealChanges: [],
      mealSwaps: [
        {
          targetMealDate: '2026-10-20',
          targetMealSlot: 'dinner',
          sourceMealDate: '2026-10-25',
          sourceMealSlot: 'lunch',
          targetVendor: 'cheftalk_regular',
        },
      ],
    };
    mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositeWithSwap);
    mockStagingRepo.getMealsByDateAndSlot.mockResolvedValue([]); // Database check returns NO meals

    // 1 (select message) -> 1 (Process Announcement) -> y (rejected) -> c (cancel) -> q (quit)
    const io = new MockIo(['1', '1', 'y', 'c', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();

    expect(mockStagingRepo.atomicCommitComposite).not.toHaveBeenCalled();
    expect(
      io.outputs.some(
        (out) =>
          out.includes('Cannot Commit Swap') &&
          out.includes('2026-10-25') &&
          out.includes('not found in database')
      )
    ).toBe(true);
  });

  it('blocks commit when swap target menu is missing (Option B gate)', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_SWAP_MISSING_TARGET_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: "Today's dinner will serve tomorrow's lunch menu",
      receivedAt: new Date('2026-10-20T06:00:00Z'),
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

    const compositeWithSwap: ExtractedCompositeAnnouncement = {
      mealDate: '2026-10-20',
      location: null,
      timingExtensions: [],
      mealChanges: [],
      mealSwaps: [
        {
          targetMealDate: '2026-10-20',
          targetMealSlot: 'dinner',
          sourceMealDate: '2026-10-21',
          sourceMealSlot: 'lunch',
          targetVendor: 'cheftalk_regular',
        },
      ],
    };
    mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositeWithSwap);

    // Source exists, but Target is missing
    mockStagingRepo.getMealsByDateAndSlot.mockImplementation(
      async (mealDate: string, mealSlot: string) => {
        if (mealDate === '2026-10-21' && mealSlot === 'lunch') {
          return [
            {
              id: 'source-1',
              mealDate: '2026-10-21',
              mealSlot: 'lunch',
              vendor: 'cheftalk_regular',
              items: ['Rajma', 'Rice'],
            },
          ];
        }
        return []; // Target does not exist
      }
    );

    const io = new MockIo(['1', '1', 'y', 'c', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();

    expect(mockStagingRepo.atomicCommitComposite).not.toHaveBeenCalled();
    expect(
      io.outputs.some(
        (out) =>
          out.includes('Cannot Commit Swap') &&
          out.includes('Target menu') &&
          out.includes('2026-10-20')
      )
    ).toBe(true);
  });

  it('commits meal swap successfully when source menu exists in database', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_SWAP_VALID_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: "Today's dinner will serve tomorrow's lunch menu",
      receivedAt: new Date('2026-10-20T06:00:00Z'),
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

    const compositeWithSwap: ExtractedCompositeAnnouncement = {
      mealDate: '2026-10-20',
      location: null,
      timingExtensions: [],
      mealChanges: [],
      mealSwaps: [
        {
          targetMealDate: '2026-10-20',
          targetMealSlot: 'dinner',
          sourceMealDate: '2026-10-21',
          sourceMealSlot: 'lunch',
          targetVendor: 'cheftalk_regular',
        },
      ],
    };
    mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositeWithSwap);

    mockStagingRepo.getMealsByDateAndSlot.mockImplementation(
      async (mealDate: string, mealSlot: string, vendor: string) => {
        if (mealDate === '2026-10-21' && mealSlot === 'lunch') {
          return [
            {
              id: 'source-1',
              mealDate: '2026-10-21',
              mealSlot: 'lunch',
              vendor: 'cheftalk_regular',
              items: ['Rajma', 'Jeera Rice', 'Boondi Raita', 'Roti', 'Gulab Jamun'],
            },
          ];
        }
        if (mealDate === '2026-10-20' && mealSlot === 'dinner') {
          return [
            {
              id: 'target-1',
              mealDate: '2026-10-20',
              mealSlot: 'dinner',
              vendor: 'cheftalk_regular',
              items: ['Original Dal', 'Original Rice'],
            },
          ];
        }
        return [];
      }
    );

    // 1 (select) -> 1 (Process Announcement) -> y (Confirm & Commit) -> q (exit)
    const io = new MockIo(['1', '1', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();

    expect(mockStagingRepo.atomicCommitComposite).toHaveBeenCalledWith({
      messageId: 'MSG_SWAP_VALID_01',
      composite: compositeWithSwap,
      resolvedSwaps: [
        {
          targetMealDate: '2026-10-20',
          targetMealSlot: 'dinner',
          sourceMealDate: '2026-10-21',
          sourceMealSlot: 'lunch',
          vendor: 'cheftalk_regular',
          newItems: ['Rajma', 'Jeera Rice', 'Boondi Raita', 'Roti', 'Gulab Jamun'],
          previousItems: ['Original Dal', 'Original Rice'],
        },
      ],
    });
  });

  it('allows Neovim editing of composite JSON before commit', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_EDIT_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: '2028 in Hostel for lunch',
      receivedAt: new Date('2026-10-20T06:00:00Z'),
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

    const initialComposite: ExtractedCompositeAnnouncement = {
      mealDate: '2026-10-20',
      location: {
        mealDate: '2026-10-20',
        mealSlot: 'lunch',
        hostelBatches: ['2028'],
        collegeBatches: [],
      },
      timingExtensions: [],
      mealChanges: [],
      mealSwaps: [],
    };
    mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(initialComposite);

    const editedComposite: ExtractedCompositeAnnouncement = {
      ...initialComposite,
      location: {
        mealDate: '2026-10-20',
        mealSlot: 'lunch',
        hostelBatches: ['2028', '2029'],
        collegeBatches: ['ALL_OTHER_BATCHES'],
      },
    };
    mockEditor.editJson.mockResolvedValue({
      success: true,
      data: editedComposite,
    });

    // 1 (select) -> 1 (Process Announcement) -> e (edit in vim) -> y (confirm) -> q (exit)
    const io = new MockIo(['1', '1', 'e', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      editor: mockEditor,
      io,
    });

    await controller.run();

    expect(mockEditor.editJson).toHaveBeenCalledWith(
      initialComposite,
      ExtractedCompositeAnnouncementSchema
    );
    expect(mockStagingRepo.atomicCommitComposite).toHaveBeenCalledWith({
      messageId: 'MSG_EDIT_01',
      composite: editedComposite,
      resolvedSwaps: [],
    });
  });

  it('ensures io.close() is called cleanly in finally when run() exits', async () => {
    mockStagingRepo.listStagedMessages.mockResolvedValue([]);
    const io = new MockIo([]);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();
    expect(io.isClosed).toBe(true);
  });

  it('wires default InteractiveJsonEditor with io.prompt retry handler', async () => {
    mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);

    const io = new MockIo(['q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    // Test that controller instance has an editor configured
    expect((controller as any).editor).toBeDefined();
    await controller.run();
    expect(io.isClosed).toBe(true);
  });
});
