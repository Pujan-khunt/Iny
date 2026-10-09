import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import crypto from 'node:crypto';
import { LoggerPort } from '../../../../core/ports/LoggerPort.js';
import { MealSlot, Vendor, MealChangeType } from '../../../../core/entities/MessMeal.js';
import { ExtractedWeeklyMenu } from '../extraction/ExtractionSchemas.js';
import {
  messMeals,
  messMealLocationDetails,
  messMealTimingExtensions,
  messMealChanges,
  whatsappGroupFoodAnnouncementsMessages,
  type WhatsappGroupFoodAnnouncementsMessageRow,
  type NewMessMealRow,
  type NewMessMealLocationDetailRow,
  type DbFoodAnnouncementStatus,
} from './schema.js';

/**
 * Filter and pagination options for listing staged WhatsApp announcement messages.
 */
export interface ListStagedMessagesOptions {
  /** Maximum number of records to return (defaults to 10). */
  limit?: number;
  /** Filter by Indian Standard Time (IST) calendar date (YYYY-MM-DD). */
  date?: string;
  /** Filter by triage status ('pending' | 'processed' | 'ignored'). */
  status?: DbFoodAnnouncementStatus | 'pending' | 'processed' | 'ignored';
}

/**
 * Operational record input types for atomic commit.
 */
export interface CommitMealsInput {
  id?: string;
  mealDate: string;
  mealSlot: MealSlot;
  vendor?: Vendor;
  items: readonly string[] | string[];
}

export interface CommitLocationDetailInput {
  id?: string;
  mealDate: string;
  mealSlot?: MealSlot;
  hostelBatches: readonly string[] | string[];
  collegeBatches: readonly string[] | string[];
}

export interface CommitTimingExtensionInput {
  id?: string;
  mealDate: string;
  mealSlot: MealSlot;
  targetVendor?: Vendor | null;
  extendedTimings: string;
}

export interface CommitMealChangeInput {
  id?: string;
  mealDate: string;
  mealSlot: MealSlot;
  targetVendor: Vendor;
  changeType: MealChangeType;
  affectedItem: string;
  originalItem?: string | null;
}

/**
 * Payload defining operational rows to insert/upsert along with the staging message commit.
 */
export interface CommitOperationalPayload {
  vendor?: Vendor;
  meals?: CommitMealsInput[];
  weeklyMenu?: ExtractedWeeklyMenu;
  locationDetails?: CommitLocationDetailInput | CommitLocationDetailInput[];
  locationDetail?: CommitLocationDetailInput;
  timingExtensions?: CommitTimingExtensionInput | CommitTimingExtensionInput[];
  timingExtension?: CommitTimingExtensionInput;
  mealChanges?: CommitMealChangeInput | CommitMealChangeInput[];
  mealChange?: CommitMealChangeInput;
}

export type AtomicCommitOptions = CommitOperationalPayload & {
  messageId: string;
};

/**
 * Outbound adapter for managing staged food announcement messages and executing
 * atomic commit, surgical undo, and development reset operations backed by PostgreSQL.
 */
export class PostgresMessStagingRepository {
  constructor(
    private readonly db: PgDatabase<any, any, any>,
    private readonly logger?: LoggerPort
  ) {}

  /**
   * Lists staged WhatsApp food announcement messages ordered by receivedAt DESC.
   * Supports filtering by IST received date and status, and limiting results (default 10).
   */
  async listStagedMessages(
    options?: ListStagedMessagesOptions
  ): Promise<WhatsappGroupFoodAnnouncementsMessageRow[]> {
    this.logger?.debug?.('Listing staged messages', { options });

    const conditions: SQL[] = [];

    if (options?.status) {
      conditions.push(
        eq(whatsappGroupFoodAnnouncementsMessages.status, options.status as DbFoodAnnouncementStatus)
      );
    }

    if (options?.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
        throw new Error(
          `Invalid date format for filter: "${options.date}". Expected ISO YYYY-MM-DD.`
        );
      }

      // Compute boundaries for the specified calendar day in India Standard Time (UTC+05:30)
      const startIst = new Date(`${options.date}T00:00:00+05:30`);
      if (isNaN(startIst.getTime())) {
        throw new Error(
          `Invalid date value for filter: "${options.date}". Expected valid calendar date.`
        );
      }

      const endIst = new Date(startIst.getTime() + 24 * 60 * 60 * 1000);

      conditions.push(gte(whatsappGroupFoodAnnouncementsMessages.receivedAt, startIst));
      conditions.push(lt(whatsappGroupFoodAnnouncementsMessages.receivedAt, endIst));
    }

    let query = this.db.select().from(whatsappGroupFoodAnnouncementsMessages);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const limit = options?.limit ?? 10;
    const rows = (await query
      .orderBy(desc(whatsappGroupFoodAnnouncementsMessages.receivedAt))
      .limit(limit)) as WhatsappGroupFoodAnnouncementsMessageRow[];

    return rows;
  }

  /**
   * Retrieves a staged message by its unique WhatsApp message ID (wamid).
   */
  async getMessageById(id: string): Promise<WhatsappGroupFoodAnnouncementsMessageRow | null> {
    this.logger?.debug?.('Fetching staged message by id', { id });

    const rows = (await this.db
      .select()
      .from(whatsappGroupFoodAnnouncementsMessages)
      .where(eq(whatsappGroupFoodAnnouncementsMessages.id, id))
      .limit(1)) as WhatsappGroupFoodAnnouncementsMessageRow[];

    return rows[0] ?? null;
  }

  /**
   * Atomically commits operational records (meals, seating locations, timing extensions, changes)
   * linking them to sourceMessageId, and updates the staged message status to 'processed'
   * with processedAt timestamp.
   */
  async atomicCommit(options: AtomicCommitOptions): Promise<void>;
  async atomicCommit(messageId: string, payload: CommitOperationalPayload): Promise<void>;
  async atomicCommit(
    messageIdOrOptions: string | AtomicCommitOptions,
    maybePayload?: CommitOperationalPayload
  ): Promise<void> {
    let messageId: string;
    let payload: CommitOperationalPayload;

    if (typeof messageIdOrOptions === 'string') {
      messageId = messageIdOrOptions;
      payload = maybePayload ?? {};
    } else {
      messageId = messageIdOrOptions.messageId;
      payload = messageIdOrOptions;
    }

    this.logger?.info?.('Executing atomic commit for message', {
      messageId,
      hasMeals: Boolean(payload.meals || payload.weeklyMenu),
      hasLocation: Boolean(payload.locationDetail || payload.locationDetails),
      hasTimings: Boolean(payload.timingExtension || payload.timingExtensions),
      hasChanges: Boolean(payload.mealChange || payload.mealChanges),
    });

    await this.db.transaction(async (tx) => {
      // 1. Process and upsert mess_meals
      const resolvedMeals: CommitMealsInput[] = [];

      if (payload.weeklyMenu) {
        for (const meal of payload.weeklyMenu.meals) {
          resolvedMeals.push({
            mealDate: meal.mealDate,
            mealSlot: meal.mealSlot,
            vendor: payload.weeklyMenu.vendor,
            items: meal.items,
          });
        }
      }

      if (payload.meals) {
        for (const meal of payload.meals) {
          resolvedMeals.push({
            ...meal,
            vendor: meal.vendor ?? payload.vendor,
          });
        }
      }

      for (const meal of resolvedMeals) {
        if (!meal.vendor) {
          throw new Error(
            `Missing vendor for meal on ${meal.mealDate} slot ${meal.mealSlot}. A vendor is required.`
          );
        }

        const mealRow: NewMessMealRow = {
          id: meal.id ?? crypto.randomUUID(),
          mealDate: meal.mealDate,
          mealSlot: meal.mealSlot,
          vendor: meal.vendor!,
          items: Array.from(meal.items),
          sourceMessageId: messageId,
          ingestedAt: new Date(),
        };

        await tx
          .insert(messMeals)
          .values(mealRow)
          .onConflictDoUpdate({
            target: [messMeals.mealDate, messMeals.mealSlot, messMeals.vendor],
            set: {
              items: mealRow.items,
              sourceMessageId: messageId,
              ingestedAt: new Date(),
            },
          });
      }

      // 2. Process and upsert mess_meal_location_details
      const resolvedLocations: CommitLocationDetailInput[] = [];
      if (payload.locationDetail) {
        resolvedLocations.push(payload.locationDetail);
      }
      if (payload.locationDetails) {
        if (Array.isArray(payload.locationDetails)) {
          resolvedLocations.push(...payload.locationDetails);
        } else {
          resolvedLocations.push(payload.locationDetails);
        }
      }

      for (const loc of resolvedLocations) {
        const slot = loc.mealSlot ?? 'lunch';
        const locRow: NewMessMealLocationDetailRow = {
          id: loc.id ?? crypto.randomUUID(),
          mealDate: loc.mealDate,
          mealSlot: slot,
          hostelBatches: Array.from(loc.hostelBatches),
          collegeBatches: Array.from(loc.collegeBatches),
          sourceMessageId: messageId,
          ingestedAt: new Date(),
        };

        await tx
          .insert(messMealLocationDetails)
          .values(locRow)
          .onConflictDoUpdate({
            target: [messMealLocationDetails.mealDate, messMealLocationDetails.mealSlot],
            set: {
              hostelBatches: locRow.hostelBatches,
              collegeBatches: locRow.collegeBatches,
              sourceMessageId: messageId,
              ingestedAt: new Date(),
            },
          });
      }

      // 3. Process and insert mess_meal_timing_extensions
      const resolvedTimings: CommitTimingExtensionInput[] = [];
      if (payload.timingExtension) {
        resolvedTimings.push(payload.timingExtension);
      }
      if (payload.timingExtensions) {
        if (Array.isArray(payload.timingExtensions)) {
          resolvedTimings.push(...payload.timingExtensions);
        } else {
          resolvedTimings.push(payload.timingExtensions);
        }
      }

      for (const timing of resolvedTimings) {
        await tx.insert(messMealTimingExtensions).values({
          id: timing.id ?? crypto.randomUUID(),
          mealDate: timing.mealDate,
          mealSlot: timing.mealSlot,
          targetVendor: timing.targetVendor ?? null,
          extendedTimings: timing.extendedTimings,
          sourceMessageId: messageId,
          ingestedAt: new Date(),
        });
      }

      // 4. Process and insert mess_meal_changes
      const resolvedChanges: CommitMealChangeInput[] = [];
      if (payload.mealChange) {
        resolvedChanges.push(payload.mealChange);
      }
      if (payload.mealChanges) {
        if (Array.isArray(payload.mealChanges)) {
          resolvedChanges.push(...payload.mealChanges);
        } else {
          resolvedChanges.push(payload.mealChanges);
        }
      }

      for (const change of resolvedChanges) {
        await tx.insert(messMealChanges).values({
          id: change.id ?? crypto.randomUUID(),
          mealDate: change.mealDate,
          mealSlot: change.mealSlot,
          targetVendor: change.targetVendor,
          changeType: change.changeType,
          affectedItem: change.affectedItem,
          originalItem: change.originalItem ?? null,
          sourceMessageId: messageId,
          ingestedAt: new Date(),
        });
      }

      // 5. Update staged message status to 'processed'
      await tx
        .update(whatsappGroupFoodAnnouncementsMessages)
        .set({
          status: 'processed',
          processedAt: new Date(),
        })
        .where(eq(whatsappGroupFoodAnnouncementsMessages.id, messageId));
    });

    this.logger?.info?.('Successfully committed staging message', { messageId });
  }

  /**
   * Marks a staged message as 'ignored'.
   */
  async markIgnored(id: string): Promise<void> {
    this.logger?.info?.('Marking staged message as ignored', { id });

    await this.db
      .update(whatsappGroupFoodAnnouncementsMessages)
      .set({
        status: 'ignored',
      })
      .where(eq(whatsappGroupFoodAnnouncementsMessages.id, id));
  }

  /**
   * Surgically undos all operational writes associated with a specific message ID,
   * deleting linked rows in all 4 operational tables, and resetting the message status
   * to 'pending' with processedAt = null.
   */
  async atomicUndo(messageId: string): Promise<void> {
    this.logger?.info?.('Executing surgical undo for message', { messageId });

    await this.db.transaction(async (tx) => {
      // 1. Delete linked rows in mess_meals
      await tx.delete(messMeals).where(eq(messMeals.sourceMessageId, messageId));

      // 2. Delete linked rows in mess_meal_location_details
      await tx
        .delete(messMealLocationDetails)
        .where(eq(messMealLocationDetails.sourceMessageId, messageId));

      // 3. Delete linked rows in mess_meal_timing_extensions
      await tx
        .delete(messMealTimingExtensions)
        .where(eq(messMealTimingExtensions.sourceMessageId, messageId));

      // 4. Delete linked rows in mess_meal_changes
      await tx.delete(messMealChanges).where(eq(messMealChanges.sourceMessageId, messageId));

      // 5. Restore staged message status to pending
      await tx
        .update(whatsappGroupFoodAnnouncementsMessages)
        .set({
          status: 'pending',
          processedAt: null,
        })
        .where(eq(whatsappGroupFoodAnnouncementsMessages.id, messageId));
    });

    this.logger?.info?.('Successfully completed surgical undo', { messageId });
  }

  /**
   * Atomically resets operational mess tables and restores all staged announcement messages
   * to status = 'pending', processedAt = null. Intended for development and local testing.
   */
  async atomicReset(): Promise<void> {
    this.logger?.warn?.('Executing atomic reset across mess operational and staging tables');

    await this.db.transaction(async (tx) => {
      // Clear operational tables
      await tx.delete(messMeals);
      await tx.delete(messMealLocationDetails);
      await tx.delete(messMealTimingExtensions);
      await tx.delete(messMealChanges);

      // Reset all staged messages to pending
      await tx.update(whatsappGroupFoodAnnouncementsMessages).set({
        status: 'pending',
        processedAt: null,
      });
    });

    this.logger?.info?.('Successfully completed atomic reset');
  }
}
