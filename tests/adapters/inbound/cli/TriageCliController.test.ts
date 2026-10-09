import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriageCliController } from '../../../../src/adapters/inbound/cli/TriageCliController.js';
import type { WhatsappGroupFoodAnnouncementsMessageRow } from '../../../../src/adapters/outbound/mess/postgres/schema.js';
import type {
  ExtractedWeeklyMenu,
  ExtractedLocationDetail,
  ExtractedTimingExtension,
  ExtractedMealChange,
} from '../../../../src/adapters/outbound/mess/extraction/ExtractionSchemas.js';

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
      markIgnored: vi.fn().mockResolvedValue(undefined),
      atomicUndo: vi.fn().mockResolvedValue(undefined),
    };

    mockVisionExtractor = {
      extractWeeklyMenu: vi.fn().mockResolvedValue(mockWeeklyMenu),
    };

    mockTextExtractor = {
      extractLocationDetail: vi.fn(),
      extractTimingExtension: vi.fn(),
      extractMealChange: vi.fn(),
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

  it('executes location detail extraction, date change, vim edit, and commit', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_LOC_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: 'UG1 and UG2 at hostel mess, UG3 at college mess',
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

    const extractedLocation: ExtractedLocationDetail = {
      mealDate: '2026-10-08',
      mealSlot: 'lunch',
      hostelBatches: ['UG1', 'UG2'],
      collegeBatches: ['UG3'],
    };
    mockTextExtractor.extractLocationDetail.mockResolvedValue(extractedLocation);

    const editedLocation: ExtractedLocationDetail = {
      ...extractedLocation,
      hostelBatches: ['UG1', 'UG2', 'PG1'],
    };
    mockEditor.editJson.mockResolvedValue({
      success: true,
      data: editedLocation,
    });

    // 1 -> Intent 2 (Location) -> 'y' -> 'd' -> '2026-10-09' -> 'e' -> 'y' (confirm) -> 'q'
    const io = new MockIo(['1', '2', 'y', 'd', '2026-10-09', 'e', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      editor: mockEditor,
      io,
    });

    await controller.run();
    expect(mockTextExtractor.extractLocationDetail).toHaveBeenCalledWith(
      textMsg.textBody,
      textMsg.receivedAt
    );
    expect(mockStagingRepo.atomicCommit).toHaveBeenCalledWith({
      messageId: 'MSG_LOC_01',
      locationDetail: editedLocation,
    });
  });

  it('executes timing extension extraction, vendor change, and commit', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_TIME_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: 'Dinner extended till 10:30 PM tonight',
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

    const extractedTiming: ExtractedTimingExtension = {
      mealDate: '2026-10-08',
      mealSlot: 'dinner',
      targetVendor: null,
      extendedTimings: 'Dinner extended till 10:30 PM',
    };
    mockTextExtractor.extractTimingExtension.mockResolvedValue(extractedTiming);

    // 1 -> Intent 3 (Timing) -> 'y' -> 'v' -> [1] (cheftalk_regular) -> 'y' (confirm) -> 'q'
    const io = new MockIo(['1', '3', 'y', 'v', '1', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();
    expect(mockTextExtractor.extractTimingExtension).toHaveBeenCalledWith(
      textMsg.textBody,
      textMsg.receivedAt
    );
    expect(mockStagingRepo.atomicCommit).toHaveBeenCalledWith({
      messageId: 'MSG_TIME_01',
      timingExtension: expect.objectContaining({
        targetVendor: 'cheftalk_regular',
      }),
    });
  });

  it('executes meal change extraction, type change, and commit', async () => {
    const textMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...samplePendingPdfMessage,
      id: 'MSG_CHANGE_01',
      messageType: 'text',
      mediaBuffer: null,
      mediaMimeType: null,
      textBody: 'Paneer Butter Masala replaced with Kadai Paneer in regular mess',
    };
    mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

    const extractedChange: ExtractedMealChange = {
      mealDate: '2026-10-08',
      mealSlot: 'lunch',
      targetVendor: 'cheftalk_regular',
      changeType: 'replacement',
      affectedItem: 'Kadai Paneer',
      originalItem: 'Paneer Butter Masala',
    };
    mockTextExtractor.extractMealChange.mockResolvedValue(extractedChange);

    // 1 -> Intent 4 (Meal Change) -> 'y' -> 't' -> [2] (addition) -> 'y' (confirm) -> 'q'
    const io = new MockIo(['1', '4', 'y', 't', '2', 'y', 'q']);

    const controller = new TriageCliController({
      stagingRepo: mockStagingRepo,
      visionExtractor: mockVisionExtractor,
      textExtractor: mockTextExtractor,
      io,
    });

    await controller.run();
    expect(mockTextExtractor.extractMealChange).toHaveBeenCalledWith(
      textMsg.textBody,
      textMsg.receivedAt
    );
    expect(mockStagingRepo.atomicCommit).toHaveBeenCalledWith({
      messageId: 'MSG_CHANGE_01',
      mealChange: expect.objectContaining({
        changeType: 'addition',
      }),
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
