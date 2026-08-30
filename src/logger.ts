import pino from "pino";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
export const LOG_FILE = process.env.LOG_FILE;

function createDestination() {
  if (LOG_FILE) {
    try {
      mkdirSync(dirname(LOG_FILE), { recursive: true });
      // Truncate/empty previous logs on startup for a fresh session log
      if (process.env.LOG_FILE_APPEND !== "true") {
        try {
          writeFileSync(LOG_FILE, "");
        } catch {
          // ignore if file doesn't exist yet
        }
      }
      return pino.destination({ dest: LOG_FILE, sync: true, mkdir: true });
    } catch {
      return process.stdout;
    }
  }
  return process.stdout;
}

export const rootLogger = pino(
  {
    level: LOG_LEVEL,
    base: {
      service: "iny",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  createDestination(),
);

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

export type PinoLogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/**
 * Dynamically adjust the global logger level at runtime.
 */
export function setLogLevel(level: PinoLogLevel): void {
  rootLogger.level = level;
}

/**
 * Mutes all logging across the application.
 */
export function disableLogging(): void {
  rootLogger.level = "silent";
}