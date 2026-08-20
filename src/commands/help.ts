import { isAdmin } from "../services/admin.js";
import type { CommandContext } from "./types.js";

export const helpCommand = {
  name: "help",
  aliases: ["commands"],
  description: "Lists all available commands",
  usage: "/help",
  execute: async (ctx: CommandContext) => {
    const admin = isAdmin(ctx.jid, ctx.altJid);
    const commands = ctx.registry.list();

    const regular = commands.filter((cmd) => !cmd.adminOnly);
    const adminCommands = commands.filter((cmd) => cmd.adminOnly);

    const lines: string[] = [];

    lines.push("Commands:");
    lines.push(
      ...regular.map((cmd) => {
        const usage = cmd.usage ?? `/${cmd.name}`;
        const description = cmd.description ? ` - ${cmd.description}` : "";
        return `${usage}${description}`;
      }),
    );

    if (admin && adminCommands.length > 0) {
      lines.push("");
      lines.push("Admin commands:");
      lines.push(
        ...adminCommands.map((cmd) => {
          const usage = cmd.usage ?? `/${cmd.name}`;
          const description = cmd.description ? ` - ${cmd.description}` : "";
          return `${usage}${description}`;
        }),
      );
    }

    await ctx.reply({ text: lines.join("\n") });
  },
};