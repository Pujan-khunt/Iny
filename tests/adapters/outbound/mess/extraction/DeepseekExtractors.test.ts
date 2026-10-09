import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { DeepseekVisionExtractor } from '../../../../../src/adapters/outbound/mess/extraction/DeepseekVisionExtractor.js';
import { DeepseekTextExtractor } from '../../../../../src/adapters/outbound/mess/extraction/DeepseekTextExtractor.js';
import {
  LLMError,
  LLMRateLimitError,
  LLMServerOverloadedError,
} from '../../../../../src/core/errors/LLMErrors.js';

function createMockOpenAI(createResponseFn: (...args: any[]) => any): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn(createResponseFn),
      },
    },
  } as unknown as OpenAI;
}

const sample21Meals = {
  vendor: 'cheftalk_regular',
  meals: Array.from({ length: 21 }, (_, i) => ({
    mealDate: `2026-10-${String(4 + Math.floor(i / 3)).padStart(2, '0')}`,
    mealSlot: ['breakfast', 'lunch', 'dinner'][i % 3],
    items: ['Item 1', 'Item 2'],
  })),
};

describe('DeepseekExtractors', () => {
  describe('DeepseekVisionExtractor', () => {
    it('initializes with apiKey or OpenAI client', () => {
      const ext1 = new DeepseekVisionExtractor('mock-api-key');
      expect(ext1).toBeDefined();

      const mockClient = createMockOpenAI(async () => ({}));
      const ext2 = new DeepseekVisionExtractor(mockClient);
      expect(ext2).toBeDefined();

      const ext3 = new DeepseekVisionExtractor({ apiKey: 'mock-key', model: 'custom-model' });
      expect(ext3).toBeDefined();
    });

    it('extracts weekly menu from image buffer successfully', async () => {
      const mockClient = createMockOpenAI(async (params: any) => {
        // Assert message payload contains base64 image data url
        expect(params.messages[1].content[1].image_url.url).toContain('data:image/png;base64,');
        return {
          choices: [
            {
              message: {
                content: JSON.stringify(sample21Meals),
              },
            },
          ],
        };
      });

      const extractor = new DeepseekVisionExtractor(mockClient);
      const fakeImage = Buffer.from('fake_image_bytes');
      const result = await extractor.extractWeeklyMenu(fakeImage);

      expect(result.vendor).toBe('cheftalk_regular');
      expect(result.meals.length).toBe(21);
      expect(result.meals[0].mealDate).toBe('2026-10-04');
    });

    it('strips markdown code blocks around JSON response', async () => {
      const mockClient = createMockOpenAI(async () => ({
        choices: [
          {
            message: {
              content: `\`\`\`json\n${JSON.stringify(sample21Meals)}\n\`\`\``,
            },
          },
        ],
      }));

      const extractor = new DeepseekVisionExtractor(mockClient);
      const result = await extractor.extractWeeklyMenu(Buffer.from('img'));
      expect(result.vendor).toBe('cheftalk_regular');
      expect(result.meals.length).toBe(21);
    });

    it('includes optional textContext in extraction prompt', async () => {
      let passedPrompt = '';
      const mockClient = createMockOpenAI(async (params: any) => {
        passedPrompt = params.messages[1].content[0].text;
        return {
          choices: [{ message: { content: JSON.stringify(sample21Meals) } }],
        };
      });

      const extractor = new DeepseekVisionExtractor(mockClient);
      await extractor.extractWeeklyMenu(Buffer.from('img'), {
        textContext: 'Weekly Menu Oct 4 - 10 Cheftalk',
      });

      expect(passedPrompt).toContain('Weekly Menu Oct 4 - 10 Cheftalk');
    });

    it('throws error when JSON does not adhere to 21-meals schema', async () => {
      const invalidMeals = {
        vendor: 'cheftalk_regular',
        meals: [{ mealDate: '2026-10-04', mealSlot: 'breakfast', items: ['Poha'] }],
      };
      const mockClient = createMockOpenAI(async () => ({
        choices: [{ message: { content: JSON.stringify(invalidMeals) } }],
      }));

      const extractor = new DeepseekVisionExtractor(mockClient);
      await expect(extractor.extractWeeklyMenu(Buffer.from('img'))).rejects.toThrow();
    });

    it('classifies HTTP 429 as LLMRateLimitError', async () => {
      const mockClient = createMockOpenAI(async () => {
        const error: any = new Error('Rate limit exceeded');
        error.status = 429;
        throw error;
      });

      const extractor = new DeepseekVisionExtractor(mockClient);
      await expect(extractor.extractWeeklyMenu(Buffer.from('img'))).rejects.toThrow(
        LLMRateLimitError
      );
    });

    it('classifies HTTP 503 as LLMServerOverloadedError and network timeouts as LLMError', async () => {
      const mockClient503 = createMockOpenAI(async () => {
        const error: any = new Error('Service Unavailable');
        error.status = 503;
        throw error;
      });

      const extractor503 = new DeepseekVisionExtractor(mockClient503);
      await expect(extractor503.extractWeeklyMenu(Buffer.from('img'))).rejects.toThrow(
        LLMServerOverloadedError
      );

      const mockClientTimeout = createMockOpenAI(async () => {
        const error: any = new Error('Connection timeout');
        error.code = 'ETIMEDOUT';
        throw error;
      });

      const extractorTimeout = new DeepseekVisionExtractor(mockClientTimeout);
      await expect(extractorTimeout.extractWeeklyMenu(Buffer.from('img'))).rejects.toThrow(
        LLMError
      );
    });
  });

  describe('DeepseekTextExtractor', () => {
    it('extracts location detail relative to receivedAt', async () => {
      const mockClient = createMockOpenAI(async (params: any) => {
        expect(params.messages[1].content).toContain('2026-10-08');
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  mealDate: '2026-10-08',
                  mealSlot: 'lunch',
                  hostelBatches: ['UG1', 'UG2'],
                  collegeBatches: ['UG3', 'UG4'],
                }),
              },
            },
          ],
        };
      });

      const extractor = new DeepseekTextExtractor(mockClient);
      const receivedAt = new Date('2026-10-08T06:00:00Z');
      const result = await extractor.extractLocationDetail(
        'Lunch today: UG1 and UG2 at Hostel mess, rest at College',
        receivedAt
      );

      expect(result.mealDate).toBe('2026-10-08');
      expect(result.mealSlot).toBe('lunch');
      expect(result.hostelBatches).toEqual(['UG1', 'UG2']);
      expect(result.collegeBatches).toEqual(['UG3', 'UG4']);
    });

    it('extracts timing extension relative to receivedAt', async () => {
      const mockClient = createMockOpenAI(async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                mealDate: '2026-10-08',
                mealSlot: 'dinner',
                targetVendor: null,
                extendedTimings: 'Extended until 10:45 PM due to college fest',
              }),
            },
          },
        ],
      }));

      const extractor = new DeepseekTextExtractor(mockClient);
      const result = await extractor.extractTimingExtension(
        'Dinner extended until 10:45 PM due to fest',
        new Date('2026-10-08T15:00:00Z')
      );

      expect(result.mealDate).toBe('2026-10-08');
      expect(result.mealSlot).toBe('dinner');
      expect(result.targetVendor).toBeNull();
      expect(result.extendedTimings).toContain('10:45 PM');
    });

    it('extracts meal change relative to receivedAt', async () => {
      const mockClient = createMockOpenAI(async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                mealDate: '2026-10-08',
                mealSlot: 'lunch',
                targetVendor: 'cheftalk_regular',
                changeType: 'replacement',
                affectedItem: 'Kadai Paneer',
                originalItem: 'Paneer Butter Masala',
              }),
            },
          },
        ],
      }));

      const extractor = new DeepseekTextExtractor(mockClient);
      const result = await extractor.extractMealChange(
        'Mix Veg replacing Paneer at Cheftalk regular today lunch',
        new Date('2026-10-08T06:00:00Z')
      );

      expect(result.mealDate).toBe('2026-10-08');
      expect(result.mealSlot).toBe('lunch');
      expect(result.targetVendor).toBe('cheftalk_regular');
      expect(result.changeType).toBe('replacement');
      expect(result.affectedItem).toBe('Kadai Paneer');
      expect(result.originalItem).toBe('Paneer Butter Masala');
    });

    it('translates rate limits to LLMRateLimitError and server errors to LLMError', async () => {
      const mockRateLimit = createMockOpenAI(async () => {
        const error: any = new Error('Too many requests');
        error.status = 429;
        throw error;
      });

      const textExtractor429 = new DeepseekTextExtractor(mockRateLimit);
      await expect(
        textExtractor429.extractLocationDetail('text', new Date())
      ).rejects.toThrow(LLMRateLimitError);

      const mockOverload = createMockOpenAI(async () => {
        const error: any = new Error('Bad gateway');
        error.status = 502;
        throw error;
      });

      const textExtractor502 = new DeepseekTextExtractor(mockOverload);
      await expect(
        textExtractor502.extractTimingExtension('text', new Date())
      ).rejects.toThrow(LLMError);
    });
  });
});
