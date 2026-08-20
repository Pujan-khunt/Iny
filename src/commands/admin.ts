import { COUNTRY_CODE } from "../config.js";
import { isAdmin } from "../services/admin.js";
import { addToAllowlist, listAllowlist, removeFromAllowlist } from "../repositories/allowlist.js";
import type { CommandContext } from "./types.js";

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

export const allowCommand = {
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

export const disallowCommand = {
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

export const allowlistCommand = {
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