import { COUNTRY_CODE } from "../config.js";
import { isAdmin } from "../services/admin.js";
import { addToAllowlist, listAllowlist, removeFromAllowlist } from "../repositories/allowlist.js";
import type { Command, CommandContext } from "./types.js";

/**
 * Validate JID format
 * Valid formats: <digits>@s.whatsapp.net, <digits>@g.us, <digits>@lid
 */
function isValidJidFormat(jid: string): boolean {
  const jidRegex = /^\d+@(s\.whatsapp\.net|g\.us|lid)$/;
  return jidRegex.test(jid);
}

/**
 * Parse phone number and convert to JID format
 * Accepts 10-digit (with country code) or 7+ digits
 */
function parsePhoneNumber(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");

  // 10-digit phone number - use country code
  if (digits.length === 10) {
    if (!COUNTRY_CODE) {
      return null; // Country code not configured
    }
    return `${COUNTRY_CODE}${digits}@s.whatsapp.net`;
  }

  // 7+ digit sequence - assume it's already formatted or partial
  if (digits.length >= 7) {
    return `${digits}@s.whatsapp.net`;
  }

  return null;
}

/**
 * Parse input as either a JID or phone number
 * Returns: { success: boolean, jid?: string, error?: string }
 */
function parseInputToJid(
  input: string
): { success: boolean; jid?: string; error?: string } {
  const trimmed = input.trim();

  // Check if it's a JID (contains @)
  if (trimmed.includes("@")) {
    if (isValidJidFormat(trimmed)) {
      return { success: true, jid: trimmed };
    }
    return {
      success: false,
      error: `Invalid JID format: "${trimmed}". Expected format: <digits>@s.whatsapp.net, <digits>@g.us, or <digits>@lid`,
    };
  }

  // Try to parse as phone number
  const phoneJid = parsePhoneNumber(trimmed);
  if (phoneJid) {
    return { success: true, jid: phoneJid };
  }

  return {
    success: false,
    error: `Invalid phone number: "${trimmed}". Expected 10 digits (with country code) or 7+ digit sequence`,
  };
}

export const allowCommand: Command = {
  name: "allow",
  description: "Allowlist a user by phone number or JID (admin only)",
  usage: "/allow <jid-or-phone> [name]",
  adminOnly: true,
  execute: async (ctx: CommandContext) => {
    if (!isAdmin(ctx.jid, ctx.altJid)) {
      await ctx.reply({ text: "You don't have permission to run this command." });
      return;
    }

    // Parse text to extract JID/phone and optional name
    const parts = ctx.text.trim().split(/\s+/);
    if (parts.length === 0) {
      await ctx.reply({
        text: "Usage: /allow <jid-or-phone> [name]\n\nExamples:\n/allow 120363410305217773@g.us Marketing Team\n/allow 9876543210 John Doe\n/allow 918490089630@s.whatsapp.net Admin",
      });
      return;
    }

    const jidInput = parts[0]!;
    const name = parts.length > 1 ? parts.slice(1).join(" ") : undefined;

    // Parse input as JID or phone number
    const parseResult = parseInputToJid(jidInput);

    if (!parseResult.success) {
      await ctx.reply({
        text: `${parseResult.error}\n\nUsage: /allow <jid-or-phone> [name]\n\nExamples:\n/allow 120363410305217773@g.us Marketing Team\n/allow 9876543210 John Doe`,
      });
      return;
    }

    const jid = parseResult.jid!;
    const result = await addToAllowlist(jid, ctx.jid, name || "");

    if (result.added) {
      await ctx.reply({
        text: `✅ Allowlisted: ${result.actualName} (${jid})`,
      });
    } else {
      // Already exists, fetch and show current name
      const { listAllowlist } = await import("../repositories/allowlist.js");
      const list = await listAllowlist();
      const entry = list.find((e) => e.jid === jid);
      const currentName = entry?.name || "Unknown";
      await ctx.reply({
        text: `ℹ️ Already allowlisted: ${currentName} (${jid})`,
      });
    }
  },
};

export const disallowCommand: Command = {
  name: "disallow",
  description: "Remove a user from the allowlist (admin only)",
  usage: "/disallow <jid-or-phone>",
  adminOnly: true,
  execute: async (ctx: CommandContext) => {
    if (!isAdmin(ctx.jid, ctx.altJid)) {
      await ctx.reply({ text: "You don't have permission to run this command." });
      return;
    }

    const jidInput = ctx.text.trim();

    if (!jidInput) {
      await ctx.reply({
        text: "Usage: /disallow <jid-or-phone>\n\nExamples:\n/disallow 120363410305217773@g.us\n/disallow 9876543210\n/disallow 918490089630@s.whatsapp.net",
      });
      return;
    }

    // Parse input as JID or phone number
    const parseResult = parseInputToJid(jidInput);

    if (!parseResult.success) {
      await ctx.reply({
        text: `${parseResult.error}\n\nUsage: /disallow <jid-or-phone>`,
      });
      return;
    }

    const jid = parseResult.jid!;
    const removed = await removeFromAllowlist(jid);

    if (removed) {
      await ctx.reply({ text: `✅ Removed from allowlist: ${jid}` });
    } else {
      await ctx.reply({ text: `ℹ️ Not in allowlist: ${jid}` });
    }
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
