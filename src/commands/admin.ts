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
  usage: "/allow <phone-or-jid> [name]",
  adminOnly: true,
  execute: async (ctx: CommandContext) => {
    if (!isAdmin(ctx.jid, ctx.altJid)) {
      await ctx.reply({ text: "You don't have permission to run this command." });
      return;
    }

    // Parse text to extract JID and optional name
    const parts = ctx.text.trim().split(/\s+/);
    if (parts.length === 0) {
      await ctx.reply({ text: "Usage: /allow <phone-or-jid> [name]" });
      return;
    }

    const jidInput = parts[0]!;
    const name = parts.length > 1 ? parts.slice(1).join(" ") : undefined;

    const jid = normalizeJidInput(jidInput);

    if (!jid) {
      await ctx.reply({ text: "Usage: /allow <phone number or JID> [name]" });
      return;
    }

    const result = await addToAllowlist(jid, ctx.jid, name || "");
    if (result.added) {
      await ctx.reply({ text: `Allowlisted ${result.actualName} (${jid})` });
    } else {
      // Already exists, fetch and show current name
      const { listAllowlist } = await import("../repositories/allowlist.js");
      const list = await listAllowlist();
      const entry = list.find((e) => e.jid === jid);
      const currentName = entry?.name || "Unknown";
      await ctx.reply({ text: `Already allowlisted: ${currentName} (${jid})` });
    }
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

    const entries = await listAllowlist();

    if (entries.length === 0) {
      await ctx.reply({ text: "Allowlist is empty." });
      return;
    }

    const lines = entries.map((entry, index) => `${index + 1}. ${entry.name} (${entry.jid})`);
    const text = `Allowlist (${entries.length} entries):\n${lines.join("\n")}`;
    await ctx.reply({ text });
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
      await ctx.reply({ text: "Admin commands:\n/allow <jid> [name] — add user to allowlist\n/disallow <jid> — remove from allowlist\n/allowlist — list allowlisted users" });
    } else {
      await ctx.reply({ text: "I'm Iny, your SST assistant. Ask me anything about policies, events etc. Just type your question naturally." });
    }
  },
};
