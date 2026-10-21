import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { PostgresMessStagingRepository } from '../../../../../src/adapters/outbound/mess/postgres/PostgresMessStagingRepository.js';
import {
  messMeals,
  messMealLocationDetails,
  messMealTimingExtensions,
  messMealChanges,
  whatsappGroupFoodAnnouncementsMessages,
} from '../../../../../src/adapters/outbound/mess/postgres/schema.js';
import { LoggerPort } from '../../../../../src/core/ports/LoggerPort.js';

describe('PostgresMessStagingRepository & Surgical Undo', () => {
  let db: NodePgDatabase;
  let repository: PostgresMessStagingRepository;
  const mockLogger: LoggerPort = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as LoggerPort;

  beforeEach(() => {
    vi.clearAllMocks();

    const memDb = newDb();
    memDb.public.none(`
      CREATE TYPE meal_slot AS ENUM ('breakfast', 'lunch', 'dinner');
      CREATE TYPE vendor AS ENUM ('cheftalk_regular', 'cheftalk_jain', 'tcb');
      CREATE TYPE meal_change_type AS ENUM ('replacement', 'addition', 'cancellation');
      CREATE TYPE food_announcement_status AS ENUM ('pending', 'processed', 'ignored');
      CREATE TYPE food_announcement_message_type AS ENUM ('image', 'document', 'text');
      CREATE TYPE sender_address_type AS ENUM ('pn', 'lid');

      CREATE TABLE mess_meals (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL,
        vendor vendor NOT NULL,
        items TEXT[] NOT NULL,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_mess_meals UNIQUE (meal_date, meal_slot, vendor)
      );

      CREATE TABLE mess_meal_location_details (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL DEFAULT 'lunch',
        hostel_batches TEXT[] NOT NULL,
        college_batches TEXT[] NOT NULL,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_mess_location UNIQUE (meal_date, meal_slot)
      );

      CREATE TABLE mess_meal_timing_extensions (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL,
        target_vendor vendor,
        extended_timings TEXT NOT NULL,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE mess_meal_changes (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL,
        target_vendor vendor NOT NULL,
        change_type meal_change_type NOT NULL,
        affected_item TEXT NOT NULL,
        original_item TEXT,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE whatsapp_group_food_announcements_messages (
        id TEXT PRIMARY KEY,
        sender_address TEXT NOT NULL,
        sender_address_type sender_address_type NOT NULL,
        message_type food_announcement_message_type NOT NULL,
        media_mime_type TEXT,
        media_buffer BYTEA,
        text_body TEXT,
        status food_announcement_status NOT NULL DEFAULT 'pending',
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ
      );
    `);

    const { Pool } = memDb.adapters.createPg();
    const pool = new Pool();
    const origQuery = pool.query.bind(pool);
    pool.query = async function (queryTextOrConfig: any, values: any, callback: any) {
      let isRowModeArray = false;
      if (typeof queryTextOrConfig === 'object' && queryTextOrConfig !== null) {
        if (queryTextOrConfig.rowMode === 'array') {
          isRowModeArray = true;
          delete queryTextOrConfig.rowMode;
        }
        delete queryTextOrConfig.types;
      }
      const result = await origQuery(queryTextOrConfig, values, callback);
      if (isRowModeArray && result && Array.isArray(result.rows)) {
        result.rows = result.rows.map((row: any) => Object.values(row));
      }
      return result;
    };

    db = drizzle(pool);
    repository = new PostgresMessStagingRepository(db as any, mockLogger);
  });

  describe('listStagedMessages', () => {
    it('returns messages ordered by receivedAt DESC with default limit 10', async () => {
      for (let i = 1; i <= 15; i++) {
        const date = new Date(Date.UTC(2026, 9, 8, 10, i, 0));
        await db.insert(whatsappGroupFoodAnnouncementsMessages).values({
          id: `msg-${String(i).padStart(2, '0')}`,
          senderAddress: `+9198765432${String(i).padStart(2, '0')}@s.whatsapp.net`,
          senderAddressType: 'pn',
          messageType: 'text',
          textBody: `Message ${i}`,
          status: 'pending',
          receivedAt: date,
        });
      }

      const results = await repository.listStagedMessages();

      expect(results).toHaveLength(10);
      expect(results[0].id).toBe('msg-15');
      expect(results[9].id).toBe('msg-06');
    });

    it('honors custom limit', async () => {
      for (let i = 1; i <= 5; i++) {
        await db.insert(whatsappGroupFoodAnnouncementsMessages).values({
          id: `msg-${i}`,
          senderAddress: `+91987654320${i}@s.whatsapp.net`,
          senderAddressType: 'pn',
          messageType: 'text',
          textBody: `Message ${i}`,
          status: 'pending',
          receivedAt: new Date(Date.UTC(2026, 9, 8, 10, i, 0)),
        });
      }

      const results = await repository.listStagedMessages({ limit: 3 });
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('msg-5');
      expect(results[2].id).toBe('msg-3');
    });

    it('filters messages by status', async () => {
      await db.insert(whatsappGroupFoodAnnouncementsMessages).values([
        {
          id: 'msg-pending',
          senderAddress: '+911111111111@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'pending',
          receivedAt: new Date(Date.UTC(2026, 9, 8, 10, 0, 0)),
        },
        {
          id: 'msg-processed',
          senderAddress: '+912222222222@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'processed',
          receivedAt: new Date(Date.UTC(2026, 9, 8, 11, 0, 0)),
        },
        {
          id: 'msg-ignored',
          senderAddress: '+913333333333@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'ignored',
          receivedAt: new Date(Date.UTC(2026, 9, 8, 12, 0, 0)),
        },
      ]);

      const pending = await repository.listStagedMessages({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('msg-pending');

      const processed = await repository.listStagedMessages({ status: 'processed' });
      expect(processed).toHaveLength(1);
      expect(processed[0].id).toBe('msg-processed');

      const ignored = await repository.listStagedMessages({ status: 'ignored' });
      expect(ignored).toHaveLength(1);
      expect(ignored[0].id).toBe('msg-ignored');
    });

    it('filters messages by IST calendar date', async () => {
      // 2026-10-08 in IST is 2026-10-07 18:30:00 UTC to 2026-10-08 18:29:59.999 UTC
      await db.insert(whatsappGroupFoodAnnouncementsMessages).values([
        {
          id: 'msg-oct7-late-utc-before-ist-midnight',
          senderAddress: '+910000000001@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'pending',
          // 2026-10-07 18:29:00 UTC = 2026-10-07 23:59:00 IST (Oct 7 in IST)
          receivedAt: new Date(Date.UTC(2026, 9, 7, 18, 29, 0)),
        },
        {
          id: 'msg-oct8-early-ist',
          senderAddress: '+910000000002@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'pending',
          // 2026-10-07 18:31:00 UTC = 2026-10-08 00:01:00 IST (Oct 8 in IST)
          receivedAt: new Date(Date.UTC(2026, 9, 7, 18, 31, 0)),
        },
        {
          id: 'msg-oct8-noon-ist',
          senderAddress: '+910000000003@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'pending',
          // 2026-10-08 06:30:00 UTC = 2026-10-08 12:00:00 IST (Oct 8 in IST)
          receivedAt: new Date(Date.UTC(2026, 9, 8, 6, 30, 0)),
        },
        {
          id: 'msg-oct8-late-ist',
          senderAddress: '+910000000004@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'pending',
          // 2026-10-08 18:29:00 UTC = 2026-10-08 23:59:00 IST (Oct 8 in IST)
          receivedAt: new Date(Date.UTC(2026, 9, 8, 18, 29, 0)),
        },
        {
          id: 'msg-oct9-early-ist',
          senderAddress: '+910000000005@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'pending',
          // 2026-10-08 18:31:00 UTC = 2026-10-09 00:01:00 IST (Oct 9 in IST)
          receivedAt: new Date(Date.UTC(2026, 9, 8, 18, 31, 0)),
        },
      ]);

      const oct8Results = await repository.listStagedMessages({ date: '2026-10-08' });
      const ids = oct8Results.map((m) => m.id);

      expect(ids).toEqual(['msg-oct8-late-ist', 'msg-oct8-noon-ist', 'msg-oct8-early-ist']);
      expect(ids).not.toContain('msg-oct7-late-utc-before-ist-midnight');
      expect(ids).not.toContain('msg-oct9-early-ist');
    });

    it('rejects invalid date formats', async () => {
      await expect(repository.listStagedMessages({ date: 'invalid-date' })).rejects.toThrow(
        /Invalid date format/
      );
    });
  });

  describe('getMessageById', () => {
    it('returns the message when found', async () => {
      await db.insert(whatsappGroupFoodAnnouncementsMessages).values({
        id: 'msg-target-1',
        senderAddress: '+919999999999@s.whatsapp.net',
        senderAddressType: 'pn',
        messageType: 'text',
        textBody: 'Hello world',
        status: 'pending',
      });

      const message = await repository.getMessageById('msg-target-1');
      expect(message).not.toBeNull();
      expect(message?.id).toBe('msg-target-1');
      expect(message?.textBody).toBe('Hello world');
      expect(message?.status).toBe('pending');
    });

    it('returns null when message does not exist', async () => {
      const message = await repository.getMessageById('non-existent');
      expect(message).toBeNull();
    });
  });

  describe('markIgnored', () => {
    it('updates status to ignored', async () => {
      await db.insert(whatsappGroupFoodAnnouncementsMessages).values({
        id: 'msg-to-ignore',
        senderAddress: '+918888888888@s.whatsapp.net',
        senderAddressType: 'pn',
        messageType: 'text',
        status: 'pending',
      });

      await repository.markIgnored('msg-to-ignore');

      const message = await repository.getMessageById('msg-to-ignore');
      expect(message?.status).toBe('ignored');
    });
  });

  describe('atomicCommit', () => {
    beforeEach(async () => {
      await db.insert(whatsappGroupFoodAnnouncementsMessages).values({
        id: 'msg-staged-1',
        senderAddress: '+917777777777@s.whatsapp.net',
        senderAddressType: 'pn',
        messageType: 'document',
        status: 'pending',
      });
    });

    it('commits weekly menu meals and updates staging status to processed', async () => {
      await repository.atomicCommit({
        messageId: 'msg-staged-1',
        meals: [
          {
            mealDate: '2026-10-08',
            mealSlot: 'breakfast',
            vendor: 'cheftalk_regular',
            items: ['Idli', 'Sambar', 'Chutney'],
          },
          {
            mealDate: '2026-10-08',
            mealSlot: 'lunch',
            vendor: 'cheftalk_regular',
            items: ['Rajma', 'Rice', 'Roti'],
          },
        ],
      });

      const meals = await db.select().from(messMeals);
      expect(meals).toHaveLength(2);
      expect(meals[0].sourceMessageId).toBe('msg-staged-1');
      expect(meals[1].sourceMessageId).toBe('msg-staged-1');

      const stagedMsg = await repository.getMessageById('msg-staged-1');
      expect(stagedMsg?.status).toBe('processed');
      expect(stagedMsg?.processedAt).toBeInstanceOf(Date);
    });

    it('upserts meals on conflict (mealDate, mealSlot, vendor)', async () => {
      await repository.atomicCommit({
        messageId: 'msg-staged-1',
        meals: [
          {
            mealDate: '2026-10-08',
            mealSlot: 'lunch',
            vendor: 'cheftalk_regular',
            items: ['Old Item 1', 'Old Item 2'],
          },
        ],
      });

      await db.insert(whatsappGroupFoodAnnouncementsMessages).values({
        id: 'msg-staged-2',
        senderAddress: '+917777777778@s.whatsapp.net',
        senderAddressType: 'pn',
        messageType: 'document',
        status: 'pending',
      });

      // Commit second message replacing the same slot
      await repository.atomicCommit({
        messageId: 'msg-staged-2',
        meals: [
          {
            mealDate: '2026-10-08',
            mealSlot: 'lunch',
            vendor: 'cheftalk_regular',
            items: ['New Item 1', 'New Item 2'],
          },
        ],
      });

      const meals = await db.select().from(messMeals);
      expect(meals).toHaveLength(1);
      expect(meals[0].items).toEqual(['New Item 1', 'New Item 2']);
      expect(meals[0].sourceMessageId).toBe('msg-staged-2');
    });

    it('commits location seating details and updates staging status', async () => {
      await repository.atomicCommit({
        messageId: 'msg-staged-1',
        locationDetails: {
          mealDate: '2026-10-08',
          mealSlot: 'lunch',
          hostelBatches: ['UG1', 'UG2'],
          collegeBatches: ['UG3', 'UG4'],
        },
      });

      const locations = await db.select().from(messMealLocationDetails);
      expect(locations).toHaveLength(1);
      expect(locations[0].hostelBatches).toEqual(['UG1', 'UG2']);
      expect(locations[0].collegeBatches).toEqual(['UG3', 'UG4']);
      expect(locations[0].sourceMessageId).toBe('msg-staged-1');

      const stagedMsg = await repository.getMessageById('msg-staged-1');
      expect(stagedMsg?.status).toBe('processed');
    });

    it('commits timing extensions and updates staging status', async () => {
      await repository.atomicCommit({
        messageId: 'msg-staged-1',
        timingExtensions: {
          mealDate: '2026-10-08',
          mealSlot: 'dinner',
          targetVendor: 'cheftalk_regular',
          extendedTimings: 'Extended till 10:30 PM',
        },
      });

      const extensions = await db.select().from(messMealTimingExtensions);
      expect(extensions).toHaveLength(1);
      expect(extensions[0].extendedTimings).toBe('Extended till 10:30 PM');
      expect(extensions[0].sourceMessageId).toBe('msg-staged-1');

      const stagedMsg = await repository.getMessageById('msg-staged-1');
      expect(stagedMsg?.status).toBe('processed');
    });

    it('commits meal changes and updates staging status', async () => {
      await repository.atomicCommit({
        messageId: 'msg-staged-1',
        mealChanges: {
          mealDate: '2026-10-08',
          mealSlot: 'lunch',
          targetVendor: 'cheftalk_regular',
          changeType: 'replacement',
          affectedItem: 'Kadai Paneer',
          originalItem: 'Paneer Butter Masala',
        },
      });

      const changes = await db.select().from(messMealChanges);
      expect(changes).toHaveLength(1);
      expect(changes[0].affectedItem).toBe('Kadai Paneer');
      expect(changes[0].originalItem).toBe('Paneer Butter Masala');
      expect(changes[0].sourceMessageId).toBe('msg-staged-1');

      const stagedMsg = await repository.getMessageById('msg-staged-1');
      expect(stagedMsg?.status).toBe('processed');
    });

    it('supports weeklyMenu object format from extractor schemas', async () => {
      await repository.atomicCommit({
        messageId: 'msg-staged-1',
        weeklyMenu: {
          vendor: 'tcb',
          meals: [
            { mealDate: '2026-10-08', mealSlot: 'breakfast', items: ['Poha'] },
            { mealDate: '2026-10-08', mealSlot: 'lunch', items: ['Chole Bhature'] },
          ],
        },
      });

      const meals = await db.select().from(messMeals);
      expect(meals).toHaveLength(2);
      expect(meals[0].vendor).toBe('tcb');
      expect(meals[1].vendor).toBe('tcb');
      expect(meals[0].sourceMessageId).toBe('msg-staged-1');
    });

    it('executes writes within a transaction and propagates errors on failure', async () => {
      const txSpy = vi
        .spyOn(db, 'transaction')
        .mockRejectedValueOnce(new Error('Simulated failure during commit transaction'));

      await expect(
        repository.atomicCommit({
          messageId: 'msg-staged-1',
          meals: [
            {
              mealDate: '2026-10-08',
              mealSlot: 'breakfast',
              vendor: 'cheftalk_regular',
              items: ['Dosa'],
            },
          ],
        })
      ).rejects.toThrow('Simulated failure during commit transaction');

      expect(txSpy).toHaveBeenCalledTimes(1);

      // Operational rows must not be inserted
      const meals = await db.select().from(messMeals);
      expect(meals).toHaveLength(0);

      // Staging status must remain pending
      const stagedMsg = await repository.getMessageById('msg-staged-1');
      expect(stagedMsg?.status).toBe('pending');
      expect(stagedMsg?.processedAt).toBeNull();
    });
  });

  describe('atomicUndo', () => {
    it('atomically deletes linked rows across all 4 operational tables and resets status to pending', async () => {
      // Seed two staged messages
      await db.insert(whatsappGroupFoodAnnouncementsMessages).values([
        {
          id: 'msg-undo-target',
          senderAddress: '+910000000001@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'document',
          status: 'processed',
          processedAt: new Date(),
        },
        {
          id: 'msg-other',
          senderAddress: '+910000000002@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'document',
          status: 'processed',
          processedAt: new Date(),
        },
      ]);

      // Seed operational rows linked to target message
      await db.insert(messMeals).values([
        {
          id: '00000000-0000-0000-0000-000000000001',
          mealDate: '2026-10-08',
          mealSlot: 'breakfast',
          vendor: 'cheftalk_regular',
          items: ['Poha'],
          sourceMessageId: 'msg-undo-target',
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          mealDate: '2026-10-08',
          mealSlot: 'lunch',
          vendor: 'cheftalk_regular',
          items: ['Dal Makhani'],
          sourceMessageId: 'msg-other', // Should NOT be deleted
        },
      ]);

      await db.insert(messMealLocationDetails).values([
        {
          id: '00000000-0000-0000-0000-000000000003',
          mealDate: '2026-10-08',
          mealSlot: 'lunch',
          hostelBatches: ['UG1'],
          collegeBatches: ['UG2'],
          sourceMessageId: 'msg-undo-target',
        },
      ]);

      await db.insert(messMealTimingExtensions).values([
        {
          id: '00000000-0000-0000-0000-000000000004',
          mealDate: '2026-10-08',
          mealSlot: 'dinner',
          targetVendor: 'cheftalk_regular',
          extendedTimings: 'Till 11 PM',
          sourceMessageId: 'msg-undo-target',
        },
      ]);

      await db.insert(messMealChanges).values([
        {
          id: '00000000-0000-0000-0000-000000000005',
          mealDate: '2026-10-08',
          mealSlot: 'dinner',
          targetVendor: 'cheftalk_regular',
          changeType: 'replacement',
          affectedItem: 'Gulab Jamun',
          originalItem: 'Kheer',
          sourceMessageId: 'msg-undo-target',
        },
      ]);

      // Execute surgical undo
      await repository.atomicUndo('msg-undo-target');

      // Verify operational rows for msg-undo-target were deleted
      const meals = await db.select().from(messMeals);
      expect(meals).toHaveLength(1);
      expect(meals[0].id).toBe('00000000-0000-0000-0000-000000000002');
      expect(meals[0].sourceMessageId).toBe('msg-other');

      const locations = await db.select().from(messMealLocationDetails);
      expect(locations).toHaveLength(0);

      const timings = await db.select().from(messMealTimingExtensions);
      expect(timings).toHaveLength(0);

      const changes = await db.select().from(messMealChanges);
      expect(changes).toHaveLength(0);

      // Verify staged message is restored to pending with null processedAt
      const restored = await repository.getMessageById('msg-undo-target');
      expect(restored?.status).toBe('pending');
      expect(restored?.processedAt).toBeNull();

      // Verify other message is unaffected
      const other = await repository.getMessageById('msg-other');
      expect(other?.status).toBe('processed');
    });
  });

  describe('atomicReset', () => {
    it('clears all operational tables and resets all staged messages to pending', async () => {
      // Seed operational data
      await db.insert(messMeals).values({
        id: '00000000-0000-0000-0000-000000000001',
        mealDate: '2026-10-08',
        mealSlot: 'lunch',
        vendor: 'cheftalk_regular',
        items: ['Rice'],
      });

      await db.insert(messMealLocationDetails).values({
        id: '00000000-0000-0000-0000-000000000002',
        mealDate: '2026-10-08',
        mealSlot: 'lunch',
        hostelBatches: ['UG1'],
        collegeBatches: ['UG2'],
      });

      await db.insert(messMealTimingExtensions).values({
        id: '00000000-0000-0000-0000-000000000003',
        mealDate: '2026-10-08',
        mealSlot: 'lunch',
        extendedTimings: 'Extended',
      });

      await db.insert(messMealChanges).values({
        id: '00000000-0000-0000-0000-000000000004',
        mealDate: '2026-10-08',
        mealSlot: 'lunch',
        targetVendor: 'cheftalk_regular',
        changeType: 'addition',
        affectedItem: 'Curd',
      });

      await db.insert(whatsappGroupFoodAnnouncementsMessages).values([
        {
          id: 'msg-1',
          senderAddress: '+911111111111@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'processed',
          processedAt: new Date(),
        },
        {
          id: 'msg-2',
          senderAddress: '+912222222222@s.whatsapp.net',
          senderAddressType: 'pn',
          messageType: 'text',
          status: 'ignored',
          processedAt: new Date(),
        },
      ]);

      await repository.atomicReset();

      // Operational tables empty
      expect(await db.select().from(messMeals)).toHaveLength(0);
      expect(await db.select().from(messMealLocationDetails)).toHaveLength(0);
      expect(await db.select().from(messMealTimingExtensions)).toHaveLength(0);
      expect(await db.select().from(messMealChanges)).toHaveLength(0);

      // Staged messages reset to pending
      const staged = await db.select().from(whatsappGroupFoodAnnouncementsMessages);
      expect(staged).toHaveLength(2);
      expect(staged.every((m) => m.status === 'pending' && m.processedAt === null)).toBe(true);
    });
  });

  describe('atomicCommitComposite & symmetric undo', () => {
    let stagingRepo: PostgresMessStagingRepository;

    beforeEach(() => {
      stagingRepo = repository;
    });

    it('atomically commits location, timing extension, and dish changes in a single transaction', async () => {
      // 1. Stage message
      const messageId = 'msg-composite-1';
      await stagingRepo.stageMessage({
        id: messageId,
        senderAddress: '+919999999999',
        senderAddressType: 'pn',
        messageType: 'text',
        textBody: 'Combo announcement',
      });

      // 2. Commit composite
      await stagingRepo.atomicCommitComposite({
        messageId,
        composite: {
          mealDate: '2026-10-20',
          location: {
            mealDate: '2026-10-20',
            mealSlot: 'lunch',
            hostelBatches: ['2028'],
            collegeBatches: ['ALL_OTHER_BATCHES'],
          },
          timingExtensions: [
            {
              mealDate: '2026-10-20',
              mealSlot: 'lunch',
              targetVendor: null,
              extendedTimings: 'Extended till 15:00',
            },
          ],
          mealChanges: [
            {
              mealDate: '2026-10-20',
              mealSlot: 'lunch',
              targetVendor: 'cheftalk_regular',
              changeType: 'replacement',
              affectedItem: 'Paneer Lababdar',
              originalItem: 'Shahi Paneer',
            },
          ],
          mealSwaps: [],
        },
      });

      // Verify status is processed
      const staged = await stagingRepo.getMessageById(messageId);
      expect(staged?.status).toBe('processed');

      // Verify operational rows exist with sourceMessageId
      const location = await db
        .select()
        .from(messMealLocationDetails)
        .where(eq(messMealLocationDetails.sourceMessageId, messageId));
      expect(location).toHaveLength(1);

      const timing = await db
        .select()
        .from(messMealTimingExtensions)
        .where(eq(messMealTimingExtensions.sourceMessageId, messageId));
      expect(timing).toHaveLength(1);

      const changes = await db
        .select()
        .from(messMealChanges)
        .where(eq(messMealChanges.sourceMessageId, messageId));
      expect(changes).toHaveLength(1);
    });

    it('mutates target meal items on meal swap and restores them on atomicUndo', async () => {
      const messageId = 'msg-swap-1';
      await stagingRepo.stageMessage({
        id: messageId,
        senderAddress: '+919999999999',
        senderAddressType: 'pn',
        messageType: 'text',
        textBody: 'Swap announcement',
      });

      // Seed base meals
      await db.insert(messMeals).values([
        {
          id: '00000000-0000-0000-0000-000000000101',
          mealDate: '2026-10-20',
          mealSlot: 'dinner',
          vendor: 'cheftalk_regular',
          items: ['Original Dinner Dal', 'Original Dinner Rice'],
          sourceMessageId: 'weekly-menu-1',
        },
        {
          id: '00000000-0000-0000-0000-000000000102',
          mealDate: '2026-10-21',
          mealSlot: 'lunch',
          vendor: 'cheftalk_regular',
          items: ['Swapped Lunch Rajma', 'Swapped Lunch Rice'],
          sourceMessageId: 'weekly-menu-1',
        },
      ]);

      // Commit swap
      await stagingRepo.atomicCommitComposite({
        messageId,
        composite: {
          mealDate: '2026-10-20',
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
        },
        resolvedSwaps: [
          {
            targetMealDate: '2026-10-20',
            targetMealSlot: 'dinner',
            vendor: 'cheftalk_regular',
            newItems: ['Swapped Lunch Rajma', 'Swapped Lunch Rice'],
            previousItems: ['Original Dinner Dal', 'Original Dinner Rice'],
            sourceMealDate: '2026-10-21',
            sourceMealSlot: 'lunch',
          },
        ],
      });

      // Verify dinner items mutated
      const [updatedDinner] = await db
        .select()
        .from(messMeals)
        .where(
          and(
            eq(messMeals.mealDate, '2026-10-20'),
            eq(messMeals.mealSlot, 'dinner'),
            eq(messMeals.vendor, 'cheftalk_regular')
          )
        );
      expect(updatedDinner.items).toEqual(['Swapped Lunch Rajma', 'Swapped Lunch Rice']);

      // Perform atomicUndo
      await stagingRepo.atomicUndo(messageId);

      // Verify dinner items restored to original
      const [restoredDinner] = await db
        .select()
        .from(messMeals)
        .where(
          and(
            eq(messMeals.mealDate, '2026-10-20'),
            eq(messMeals.mealSlot, 'dinner'),
            eq(messMeals.vendor, 'cheftalk_regular')
          )
        );
      expect(restoredDinner.items).toEqual(['Original Dinner Dal', 'Original Dinner Rice']);

      // Verify message status reset to pending
      const resetStaged = await stagingRepo.getMessageById(messageId);
      expect(resetStaged?.status).toBe('pending');
    });

    it('throws error and aborts transaction if resolvedSwaps contains empty previousItems', async () => {
      const messageId = 'msg-swap-empty-prev';
      await db.insert(whatsappGroupFoodAnnouncementsMessages).values({
        id: messageId,
        senderAddress: '+919999999999@s.whatsapp.net',
        senderAddressType: 'pn',
        messageType: 'text',
        textBody: 'Swap announcement',
        status: 'pending',
      });

      await expect(
        stagingRepo.atomicCommitComposite({
          messageId,
          composite: {
            mealDate: '2026-10-20',
            timingExtensions: [],
            mealChanges: [],
            mealSwaps: [],
          },
          resolvedSwaps: [
            {
              targetMealDate: '2026-10-20',
              targetMealSlot: 'dinner',
              vendor: 'cheftalk_regular',
              newItems: ['Swapped Rice'],
              previousItems: [],
              sourceMealDate: '2026-10-21',
              sourceMealSlot: 'lunch',
            },
          ],
        })
      ).rejects.toThrow(/previousItems backup must not be empty/);
    });
  });
});
