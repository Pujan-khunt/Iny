import { COUNTRY_CODE } from "../config.js";
import { isAdmin } from "../services/admin.js";
import { addToAllowlist, listAllowlist, removeFromAllowlist } from "../repositories/allowlist.js";
import type { Command, CommandContext } from "./types.js";

function normalizeJidInput(input: string): string | null {
  const trimmed = input.trim();

  if (trimmed.includes("@")) {
    return trimmed;
  }

  const digits = trimmed.replace(/[^0-9]/g, "");

  if (digits.length === 10) {
    if (!COUNTRY_CODE) {
      return null;
    }

    return `${COUNTRY_CODE}${digits}@s.whatsapp.net`;
  }

  if (digits.length < 7) {
    return null;
  }

  return `${digits}@s.whatsapp.net`;
}

export const allowCommand: Command = {
  name: "allow",
  description: "Allowlist a user by phone number or JID (admin only)",
  usage: "/allow <10-digit-phone-number>",
  adminOnly: true,
  execute: async (ctx: CommandContext) => {
    if (!isAdmin(ctx.jid, ctx.altJid)) {
      await ctx.reply({ text: "You don't have permission to run this command." });
      return;
    }

    const jid = normalizeJidInput(ctx.text);

    if (!jid) {
      await ctx.reply({ text: "Usage: /allow <phone number or JID>" });
      return;
    }

    const added = await addToAllowlist(jid, ctx.jid);
    await ctx.reply({ text: added ? `Allowlisted ${jid}` : `Already allowlisted: ${jid}` });
  },
};

export const disallowCommand: Command = {
  name: "disallow",
  description: "Remove a user from the allowlist (admin only)",
  usage: "/disallow <phone-or-jid>",
  adminOnly: true,
  execute: async (ctx: CommandContext) => {
    if (!isAdmin(ctx.jid, ctx.altJid)) {
      await ctx.reply({ text: "You don't have permission to run this command." });
      return;
    }

    const jid = normalizeJidInput(ctx.text);

    if (!jid) {
      await ctx.reply({ text: "Usage: /disallow <phone number or JID>" });
      return;
    }

    const removed = await removeFromAllowlist(jid);
    await ctx.reply({ text: removed ? `Removed ${jid} from allowlist` : `Not in allowlist: ${jid}` });
  },
};

export const allowlistCommand: Command = {
  name: "allowlist",
  description: "List all allowlisted users (admin only)",
  adminOnly: true,
  execute: async (ctx: CommandContext) => {
    if (!isAdmin(ctx.jid, ctx.altJid)) {
      await ctx.reply({ text: "You don't have permission to run this command." });
      return;
    }

    const jids = await listAllowlist();

    if (jids.length === 0) {
      await ctx.reply({ text: "Allowlist is empty." });
      return;
    }

    const lines = jids.map((jid, index) => `${index + 1}. ${jid}`);
    await ctx.reply({ text: lines.join("\n") });
  },
};

export const helpCommand: Command = {
  name: "help",
  description: "Show Iny's capabilities",
  adminOnly: false,
  execute: async (ctx: CommandContext) => {
    const { isAdmin } = await import("../services/admin.js");
    const admin = isAdmin(ctx.jid, ctx.altJid);

    if (admin) {
      await ctx.reply({ text: "Admin commands:\n/allow <number> — add user to allowlist\n/disallow <number> — remove from allowlist\n/allowlist — list allowlisted users" });
    } else {
      await ctx.reply({ text: "I'm Iny, your SST assistant. Ask me anything about policies, events etc. Just type your question naturally." });
    }
  },
};
