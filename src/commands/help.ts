import type { CommandContext } from "./types.js";

export const helpCommand = {
  name: "help",
  aliases: ["commands"],
  description: "Lists all available commands",
  usage: "/help",
  execute: async (ctx: CommandContext) => {
    const lines = ctx.registry.list().map((cmd) => {
      const usage = cmd.usage ?? `/${cmd.name}`;
      const description = cmd.description ? ` - ${cmd.description}` : "";
      return `${usage}${description}`;
    });

    await ctx.reply({ text: lines.join("\n") });
  },
};