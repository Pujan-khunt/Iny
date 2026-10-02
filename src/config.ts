import { z } from 'zod';

const emptyToUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((val) => (typeof val === 'string' && val.trim() === '' ? undefined : val), schema);

export const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().trim().min(1, 'DEEPSEEK_API_KEY is required'),
  SYSTEM_PROMPT: z.string().trim().min(1, 'SYSTEM_PROMPT is required'),
  BOT_PHONE_NUMBER: z
    .string()
    .trim()
    .regex(/^\d+$/, 'BOT_PHONE_NUMBER must contain digits only with country code'),
  ALLOWED_USERS: emptyToUndefined(
    z
      .string()
      .optional()
      .default('')
      .transform((val) =>
        val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
  ),
  DATABASE_URL: z
    .string()
    .trim()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (url) => url.startsWith('postgres://') || url.startsWith('postgresql://'),
      'DATABASE_URL must be a valid PostgreSQL connection URI (postgres:// or postgresql://)'
    ),
  DB_MAX_CONNECTIONS: emptyToUndefined(z.coerce.number().int().positive().default(10)),
  DEEPSEEK_BASE_URL: emptyToUndefined(z.url().default('https://api.deepseek.com')),
  DEEPSEEK_MODEL: emptyToUndefined(z.string().min(1).default('deepseek-flash')),
  LOG_LEVEL: emptyToUndefined(z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info')),
  MAX_TOOL_ITERATIONS: emptyToUndefined(z.coerce.number().int().positive().max(20).default(5)),
  MAX_HISTORY_TURNS: emptyToUndefined(z.coerce.number().int().positive().max(100).default(10)),
});

export type Config = z.infer<typeof envSchema>;

export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsedEnv = envSchema.safeParse(env);
  if (!parsedEnv.success) {
    console.error('❌ Invalid environment variables:\n' + z.prettifyError(parsedEnv.error));
    throw new Error('Invalid environment variables');
  }
  return parsedEnv.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseConfig(env);
}
