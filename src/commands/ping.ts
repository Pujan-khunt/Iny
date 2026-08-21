import type { Command, CommandContext } from "./types.js";

export const pingCommand: Command = {
  name: "ping",
  description: "Replies with pong",
  execute: async (ctx: CommandContext) => {
    await ctx.reply({ text: "pong" });
  },
};
