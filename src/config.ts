import { z } from 'zod';

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1, 'DEEPSEEK_API_KEY is required'),
  SYSTEM_PROMPT: z.string().min(1, 'SYSTEM_PROMPT is required'),
  DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().min(1).default('deepseek-flash'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().max(20).default(5),
  MAX_HISTORY_TURNS: z.coerce.number().int().positive().max(100).default(10),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:\n' + z.prettifyError(parsedEnv.error));
  throw new Error('Invalid environment variables');
}

export const config = parsedEnv.data;
