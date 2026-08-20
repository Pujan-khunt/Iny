import type { AnyMessageContent, MiscMessageGenerationOptions, WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import type { Stores } from "../store.js";
import type { CommandRegistry } from "./registry.js";

export interface CommandContext {
  socket: WASocket;
  logger: ILogger;
  stores: Stores;
  registry: CommandRegistry;
  msg: WAMessage;
  jid: string;
  altJid?: string | undefined;
  name: string;
  args: string[];
  text: string;
  reply: (content: AnyMessageContent, options?: MiscMessageGenerationOptions) => Promise<void>;
}

export interface Command {
  name: string;
  aliases?: string[];
  description?: string;
  usage?: string;
  adminOnly?: boolean;
  execute: (ctx: CommandContext) => Promise<void>;
}