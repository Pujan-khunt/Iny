import { z } from 'zod';

export const ExtractedWeeklyMealItemSchema = z.object({
  mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO YYYY-MM-DD'),
  mealSlot: z.enum(['breakfast', 'lunch', 'dinner']),
  items: z.array(z.string().min(1)).min(1),
});

export const ExtractedWeeklyMenuSchema = z.object({
  vendor: z.enum(['cheftalk_regular', 'cheftalk_jain', 'tcb']),
  meals: z.array(ExtractedWeeklyMealItemSchema).length(21),
});

export const ExtractedLocationDetailSchema = z.object({
  mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO YYYY-MM-DD'),
  mealSlot: z.enum(['breakfast', 'lunch', 'dinner']).default('lunch'),
  hostelBatches: z.array(z.string()).default([]),
  collegeBatches: z.array(z.string()).default([]),
});

export const ExtractedTimingExtensionSchema = z.object({
  mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO YYYY-MM-DD'),
  mealSlot: z.enum(['breakfast', 'lunch', 'dinner']),
  targetVendor: z.enum(['cheftalk_regular', 'cheftalk_jain', 'tcb']).nullable().default(null),
  extendedTimings: z.string().min(1),
});

export const ExtractedMealChangeSchema = z.object({
  mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO YYYY-MM-DD'),
  mealSlot: z.enum(['breakfast', 'lunch', 'dinner']),
  targetVendor: z.enum(['cheftalk_regular', 'cheftalk_jain', 'tcb']),
  changeType: z.enum(['replacement', 'addition', 'cancellation']),
  affectedItem: z.string().min(1),
  originalItem: z.string().nullable().default(null),
});

export const ExtractedMealSwapSchema = z.object({
  targetMealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetMealSlot: z.enum(['breakfast', 'lunch', 'dinner']),
  sourceMealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceMealSlot: z.enum(['breakfast', 'lunch', 'dinner']),
  targetVendor: z.enum(['cheftalk_regular', 'cheftalk_jain', 'tcb']).nullable().optional(),
});

export const ExtractedCompositeAnnouncementSchema = z.object({
  mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: ExtractedLocationDetailSchema.optional().nullable(),
  timingExtensions: z.array(ExtractedTimingExtensionSchema).default([]),
  mealChanges: z.array(ExtractedMealChangeSchema).default([]),
  mealSwaps: z.array(ExtractedMealSwapSchema).default([]),
});

export type ExtractedWeeklyMealItem = z.infer<typeof ExtractedWeeklyMealItemSchema>;
export type ExtractedWeeklyMenu = z.infer<typeof ExtractedWeeklyMenuSchema>;
export type ExtractedLocationDetail = z.infer<typeof ExtractedLocationDetailSchema>;
export type ExtractedTimingExtension = z.infer<typeof ExtractedTimingExtensionSchema>;
export type ExtractedMealChange = z.infer<typeof ExtractedMealChangeSchema>;
export type ExtractedMealSwap = z.infer<typeof ExtractedMealSwapSchema>;
export type ExtractedCompositeAnnouncement = z.infer<typeof ExtractedCompositeAnnouncementSchema>;

