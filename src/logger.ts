import pino from "pino";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";

export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

export const rootLogger = pino({
  level: LOG_LEVEL,
  base: {
    service: "iny",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Get a structured child logger tagged with the component module name.
 * Ideal for internal services (agent, source-cache, tool-executors, etc.).
 */
export function getLogger(module: string): pino.Logger {
  return rootLogger.child({ module });
}

/**
 * Creates a Baileys-compatible child logger.
 */
export function createLogger(className = "baileys"): ILogger {
  return rootLogger.child({ class: className }) as unknown as ILogger;
}