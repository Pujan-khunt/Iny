import { describe, it, expect } from 'vitest';
import { TriageTerminalView, stripAnsi } from '../../../../src/adapters/inbound/cli/TriageTerminalView.js';
import type { WhatsappGroupFoodAnnouncementsMessageRow } from '../../../../src/adapters/outbound/mess/postgres/schema.js';
import type {
  ExtractedWeeklyMenu,
  ExtractedLocationDetail,
  ExtractedTimingExtension,
  ExtractedMealChange,
} from '../../../../src/adapters/outbound/mess/extraction/ExtractionSchemas.js';

describe('TriageTerminalView', () => {
  const view = new TriageTerminalView({ enableAnsi: false });

  const mockMessage: WhatsappGroupFoodAnnouncementsMessageRow = {
    id: '3EB0A1B2C3D4E5F6',
    senderAddress: '+919876543210',
    senderAddressType: 'pn',
    messageType: 'document',
    mediaMimeType: 'application/pdf',
    mediaBuffer: Buffer.from('%PDF-1.4 test'),
    textBody: 'WEEKLY MENU OCT 4-10-3.pdf',
    status: 'pending',
    receivedAt: new Date('2026-10-08T06:12:15.000Z'),
    processedAt: null,
  };

  it('renders messages table with columns and formatting', () => {
    const table = view.renderMessagesTable([mockMessage]);
    expect(table).toContain('3EB0A1B2C3D4E5F6');
    expect(table).toContain('+919876543210 (pn)');
    expect(table).toContain('document');
    expect(table).toContain('pending');
  });

  it('renders pre-extraction inspection card matching Spec 4.2', () => {
    const card = view.renderInspectionCard(mockMessage, 'Weekly Menu');
    expect(card).toContain('MESSAGE INSPECTION & CONFIRMATION');
    expect(card).toContain('3EB0A1B2C3D4E5F6');
    expect(card).toContain('+919876543210 (pn)');
    expect(card).toContain('document (application/pdf');
    expect(card).toContain('WEEKLY MENU OCT 4-10-3.pdf');
    expect(card).toContain('[1] Weekly Menu');
    expect(card).toContain('[y] Proceed with Extraction');
    expect(card).toContain('[o] Open Media');
    expect(card).toContain('[c] Cancel / Back to List');
  });

  it('renders inspection card with custom intent index (e.g. [2] Location Detail)', () => {
    const card = view.renderInspectionCard(mockMessage, 'Location Detail', '2');
    expect(card).toContain('Selected Action:[2] Location Detail');
  });

  it('renders non-fatal extraction error card matching Spec 4.2', () => {
    const errorCard = view.renderExtractionErrorCard(
      new Error('Rate limit reached for deepseek-flash. Please wait 5s.'),
      '3EB0A1B2C3D4E5F6'
    );
    expect(errorCard).toContain('EXTRACTION ENCOUNTERED AN ERROR');
    expect(errorCard).toContain('Rate limit reached for deepseek-flash');
    expect(errorCard).toContain('3EB0A1B2C3D4E5F6');
    expect(errorCard).toContain('Staging State: UNCHANGED');
    expect(errorCard).toContain('[r] Retry Extraction');
    expect(errorCard).toContain('[c] Cancel & Return to Message List');
  });

  it('renders weekly menu extraction preview with 21 slots matching Spec 4.4', () => {
    const weeklyMenu: ExtractedWeeklyMenu = {
      vendor: 'cheftalk_regular',
      meals: [
        {
          mealDate: '2026-10-04',
          mealSlot: 'breakfast',
          items: ['Aloo Paratha', 'Curd'],
        },
        {
          mealDate: '2026-10-04',
          mealSlot: 'lunch',
          items: ['Paneer Butter Masala', 'Rice'],
        },
        {
          mealDate: '2026-10-04',
          mealSlot: 'dinner',
          items: ['Dal Fry', 'Roti'],
        },
      ] as any,
    };
    // Pad to 21 slots for testing
    const slots = ['breakfast', 'lunch', 'dinner'] as const;
    const days = [
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ];
    weeklyMenu.meals = [];
    for (const d of days) {
      for (const s of slots) {
        weeklyMenu.meals.push({
          mealDate: d,
          mealSlot: s,
          items: ['Item 1', 'Item 2'],
        });
      }
    }

    const preview = view.renderWeeklyMenuPreview(weeklyMenu);
    expect(preview).toContain('WEEKLY MENU EXTRACTION PREVIEW');
    expect(preview).toContain('cheftalk_regular');
    expect(preview).toContain('2026-10-04');
    expect(preview).toContain('2026-10-10');
    expect(preview).toContain('Total Slots:    21 meals');
    expect(preview).toContain('Contiguous 7-day span');
    expect(preview).toContain('[y] Confirm & Commit to Database');
    expect(preview).toContain('[v] Switch Vendor');
    expect(preview).toContain('[d] Shift Dates');
    expect(preview).toContain('[e] Edit in vim');
  });

  it('renders location seating preview matching Spec 4.4', () => {
    const locationData: ExtractedLocationDetail = {
      mealDate: '2026-10-08',
      mealSlot: 'lunch',
      hostelBatches: ['UG1', 'UG2', 'PG1', 'PhD'],
      collegeBatches: ['UG3', 'UG4', 'PG2'],
    };

    const preview = view.renderLocationDetailPreview(locationData, mockMessage);
    expect(preview).toContain('SEATING ALLOCATION PREVIEW');
    expect(preview).toContain('2026-10-08');
    expect(preview).toContain('Hostel Mess');
    expect(preview).toContain('UG1, UG2, PG1, PhD');
    expect(preview).toContain('College Mess');
    expect(preview).toContain('UG3, UG4, PG2');
    expect(preview).toContain('[y] Confirm & Commit');
    expect(preview).toContain('[d] Change Date');
    expect(preview).toContain('[e] Edit Batches in vim');
  });

  it('renders timing extension preview matching Spec 4.4', () => {
    const timingData: ExtractedTimingExtension = {
      mealDate: '2026-10-08',
      mealSlot: 'dinner',
      targetVendor: null,
      extendedTimings: 'Extended until 10:45 PM due to college fest',
    };

    const preview = view.renderTimingExtensionPreview(timingData, mockMessage);
    expect(preview).toContain('MEAL TIMING EXTENSION PREVIEW');
    expect(preview).toContain('2026-10-08');
    expect(preview).toContain('dinner');
    expect(preview).toContain('All Vendors (Global)');
    expect(preview).toContain('Extended until 10:45 PM due to college fest');
    expect(preview).toContain('[y] Confirm & Commit');
    expect(preview).toContain('[v] Assign to specific vendor');
  });

  it('renders meal change preview matching Spec 4.4', () => {
    const changeData: ExtractedMealChange = {
      mealDate: '2026-10-08',
      mealSlot: 'lunch',
      targetVendor: 'cheftalk_regular',
      changeType: 'replacement',
      affectedItem: 'Kadai Paneer',
      originalItem: 'Paneer Butter Masala',
    };

    const preview = view.renderMealChangePreview(changeData, mockMessage);
    expect(preview).toContain('MEAL CHANGE / REPLACEMENT PREVIEW');
    expect(preview).toContain('2026-10-08');
    expect(preview).toContain('cheftalk_regular');
    expect(preview).toContain('REPLACEMENT');
    expect(preview).toContain('Paneer Butter Masala');
    expect(preview).toContain('Kadai Paneer');
    expect(preview).toContain('[y] Confirm & Commit');
    expect(preview).toContain('[t] Change Type');
  });

  it('renders ignore message preview matching Spec 4.4', () => {
    const preview = view.renderIgnorePreview(mockMessage);
    expect(preview).toContain('IGNORE STAGED MESSAGE');
    expect(preview).toContain('3EB0A1B2C3D4E5F6');
    expect(preview).toContain('[y] Confirm Ignore | [c] Cancel');
  });

  it('renders processed message actions undo card matching Spec 4.4', () => {
    const processedMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
      ...mockMessage,
      status: 'processed',
      processedAt: new Date('2026-10-09T06:15:00.000Z'),
    };

    const card = view.renderProcessedMessageCard(processedMsg);
    expect(card).toContain('PROCESSED MESSAGE ACTIONS');
    expect(card).toContain('3EB0A1B2C3D4E5F6');
    expect(card).toContain('[u] Undo / Revert Ingestion');
    expect(card).toContain('[c] Cancel / Back to List');
  });

  it('renders with ANSI codes by default and stripAnsi strips them', () => {
    const ansiView = new TriageTerminalView();
    const table = ansiView.renderMessagesTable([mockMessage]);
    expect(table).toContain('\x1b[');
    const stripped = stripAnsi(table);
    expect(stripped).not.toContain('\x1b[');
    expect(stripped).toContain('3EB0A1B2C3D4E5F6');
  });
});
