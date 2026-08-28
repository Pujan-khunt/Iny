import type { Command, CommandContext } from "./types.js";

export const helpCommand: Command = {
  name: "help",
  description: "Show Iny's capabilities",
  adminOnly: false,
  execute: async (ctx: CommandContext) => {
    const { isAdmin } = await import("../services/admin.js");
    const adminCheckJids = ctx.allJids ?? [ctx.jid, ctx.altJid].filter(Boolean) as string[];
    const admin = isAdmin(adminCheckJids);

    if (admin) {
      const text =
        `*Iny Admin Commands:*\n\n` +
        `• */allow <jid-or-phone> [name]* - Add a user/group to the allowlist\n` +
        `• */disallow <jid-or-phone>* - Remove a user/group from the allowlist\n` +
        `• */allowlist* - List all allowlisted entries\n` +
        `• */help* - Show this help message`;
      await ctx.reply({ text });
    } else {
      const text =
        `*Hi! I'm Iny, your assistant for Scaler School of Technology (SST).*\n\n` +
        `You can ask me anything related to SST policies, procedures, and campus operations.\n\n` +
        `*How to use:*\n` +
        `• Ask any policy question directly (e.g., "What is the SEV policy?")\n` +
        `• Ask procedural questions (e.g., "How do I get a bonafide certificate?")\n` +
        `• Reply to any of my responses asking for *sources* or *references* to see where the information came from.`;
      await ctx.reply({ text });
    }
  },
};
