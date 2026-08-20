import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import pino from "pino";

export function createLogger(): ILogger {
  const baseLogger = pino();
  return baseLogger.child({ class: "baileys" });
}