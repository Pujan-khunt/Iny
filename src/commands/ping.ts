import type { CommandContext } from "./types.js";

export const pingCommand = {
  name: "ping",
  description: "Replies with pong",
  execute: async (ctx: CommandContext) => {
    await ctx.reply({ text: "pong" });
  },
};