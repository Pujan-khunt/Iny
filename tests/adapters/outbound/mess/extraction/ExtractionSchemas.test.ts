import { describe, it, expect } from 'vitest';
import {
  ExtractedWeeklyMenuSchema,
  ExtractedLocationDetailSchema,
  ExtractedTimingExtensionSchema,
  ExtractedMealChangeSchema,
} from '../../../../../src/adapters/outbound/mess/extraction/ExtractionSchemas.js';

describe('Extraction Schemas', () => {
  describe('ExtractedWeeklyMenuSchema', () => {
    it('validates 21 meal slots with strict ISO date format', () => {
      const invalidDates = {
        vendor: 'cheftalk_regular',
        meals: Array.from({ length: 21 }, () => ({
          mealDate: '04/10/2026', // Invalid format
          mealSlot: 'breakfast',
          items: ['Poha'],
        })),
      };
      expect(() => ExtractedWeeklyMenuSchema.parse(invalidDates)).toThrow();

      const valid = {
        vendor: 'cheftalk_regular',
        meals: Array.from({ length: 21 }, (_, i) => ({
          mealDate: `2026-10-${String(4 + Math.floor(i / 3)).padStart(2, '0')}`,
          mealSlot: ['breakfast', 'lunch', 'dinner'][i % 3],
          items: ['Poha'],
        })),
      };
      expect(ExtractedWeeklyMenuSchema.parse(valid)).toBeDefined();
    });

    it('rejects arrays with not exactly 21 meals', () => {
      const twentyMeals = {
        vendor: 'cheftalk_regular',
        meals: Array.from({ length: 20 }, (_, i) => ({
          mealDate: '2026-10-04',
          mealSlot: ['breakfast', 'lunch', 'dinner'][i % 3],
          items: ['Poha'],
        })),
      };
      expect(() => ExtractedWeeklyMenuSchema.parse(twentyMeals)).toThrow();

      const twentyTwoMeals = {
        vendor: 'cheftalk_regular',
        meals: Array.from({ length: 22 }, (_, i) => ({
          mealDate: '2026-10-04',
          mealSlot: ['breakfast', 'lunch', 'dinner'][i % 3],
          items: ['Poha'],
        })),
      };
      expect(() => ExtractedWeeklyMenuSchema.parse(twentyTwoMeals)).toThrow();
    });

    it('rejects invalid meal slots and invalid vendors', () => {
      const invalidSlot = {
        vendor: 'cheftalk_regular',
        meals: Array.from({ length: 21 }, () => ({
          mealDate: '2026-10-04',
          mealSlot: 'snacks',
          items: ['Samosa'],
        })),
      };
      expect(() => ExtractedWeeklyMenuSchema.parse(invalidSlot)).toThrow();

      const invalidVendor = {
        vendor: 'unknown_vendor',
        meals: Array.from({ length: 21 }, (_, i) => ({
          mealDate: '2026-10-04',
          mealSlot: ['breakfast', 'lunch', 'dinner'][i % 3],
          items: ['Poha'],
        })),
      };
      expect(() => ExtractedWeeklyMenuSchema.parse(invalidVendor)).toThrow();
    });

    it('rejects empty items array or empty item strings', () => {
      const emptyItems = {
        vendor: 'tcb',
        meals: Array.from({ length: 21 }, () => ({
          mealDate: '2026-10-04',
          mealSlot: 'breakfast',
          items: [],
        })),
      };
      expect(() => ExtractedWeeklyMenuSchema.parse(emptyItems)).toThrow();

      const emptyItemString = {
        vendor: 'tcb',
        meals: Array.from({ length: 21 }, () => ({
          mealDate: '2026-10-04',
          mealSlot: 'breakfast',
          items: [''],
        })),
      };
      expect(() => ExtractedWeeklyMenuSchema.parse(emptyItemString)).toThrow();
    });
  });

  describe('ExtractedLocationDetailSchema', () => {
    it('validates location details and defaults mealSlot to lunch', () => {
      const input = {
        mealDate: '2026-10-08',
        hostelBatches: ['UG1', 'UG2', 'PG1'],
        collegeBatches: ['UG3', 'UG4'],
      };
      const parsed = ExtractedLocationDetailSchema.parse(input);
      expect(parsed.mealSlot).toBe('lunch');
      expect(parsed.hostelBatches).toEqual(['UG1', 'UG2', 'PG1']);
      expect(parsed.collegeBatches).toEqual(['UG3', 'UG4']);
    });

    it('allows specifying custom mealSlot', () => {
      const input = {
        mealDate: '2026-10-08',
        mealSlot: 'dinner',
        hostelBatches: [],
        collegeBatches: ['UG1'],
      };
      const parsed = ExtractedLocationDetailSchema.parse(input);
      expect(parsed.mealSlot).toBe('dinner');
    });

    it('rejects invalid mealDate', () => {
      expect(() =>
        ExtractedLocationDetailSchema.parse({
          mealDate: '08/10/2026',
          hostelBatches: [],
          collegeBatches: [],
        })
      ).toThrow();
    });
  });

  describe('ExtractedTimingExtensionSchema', () => {
    it('validates timing extension with targetVendor', () => {
      const input = {
        mealDate: '2026-10-08',
        mealSlot: 'dinner',
        targetVendor: 'cheftalk_regular',
        extendedTimings: 'Extended until 10:45 PM due to fest',
      };
      const parsed = ExtractedTimingExtensionSchema.parse(input);
      expect(parsed.targetVendor).toBe('cheftalk_regular');
      expect(parsed.extendedTimings).toContain('10:45 PM');
    });

    it('allows nullable targetVendor for global extensions', () => {
      const input = {
        mealDate: '2026-10-08',
        mealSlot: 'dinner',
        targetVendor: null,
        extendedTimings: 'Extended till 11:00 PM for all messes',
      };
      const parsed = ExtractedTimingExtensionSchema.parse(input);
      expect(parsed.targetVendor).toBeNull();
    });

    it('rejects invalid mealSlot or invalid mealDate', () => {
      expect(() =>
        ExtractedTimingExtensionSchema.parse({
          mealDate: '2026-10-08',
          mealSlot: 'tea',
          targetVendor: null,
          extendedTimings: 'Extended',
        })
      ).toThrow();

      expect(() =>
        ExtractedTimingExtensionSchema.parse({
          mealDate: 'October 8',
          mealSlot: 'lunch',
          targetVendor: null,
          extendedTimings: 'Extended',
        })
      ).toThrow();
    });
  });

  describe('ExtractedMealChangeSchema', () => {
    it('validates replacement meal change', () => {
      const input = {
        mealDate: '2026-10-08',
        mealSlot: 'lunch',
        targetVendor: 'cheftalk_regular',
        changeType: 'replacement',
        affectedItem: 'Kadai Paneer',
        originalItem: 'Paneer Butter Masala',
      };
      const parsed = ExtractedMealChangeSchema.parse(input);
      expect(parsed.changeType).toBe('replacement');
      expect(parsed.affectedItem).toBe('Kadai Paneer');
      expect(parsed.originalItem).toBe('Paneer Butter Masala');
    });

    it('validates addition meal change with null originalItem', () => {
      const input = {
        mealDate: '2026-10-08',
        mealSlot: 'dinner',
        targetVendor: 'tcb',
        changeType: 'addition',
        affectedItem: 'Ice Cream',
        originalItem: null,
      };
      const parsed = ExtractedMealChangeSchema.parse(input);
      expect(parsed.changeType).toBe('addition');
      expect(parsed.originalItem).toBeNull();
    });

    it('rejects invalid changeType', () => {
      expect(() =>
        ExtractedMealChangeSchema.parse({
          mealDate: '2026-10-08',
          mealSlot: 'lunch',
          targetVendor: 'cheftalk_regular',
          changeType: 'modification',
          affectedItem: 'Kadai Paneer',
        })
      ).toThrow();
    });
  });
});
