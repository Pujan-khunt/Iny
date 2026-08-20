import type { CommandContext } from "./types.js";

export const echoCommand = {
  name: "echo",
  description: "Replies with the provided text",
  usage: "/echo <text>",
  execute: async (ctx: CommandContext) => {
    await ctx.reply({ text: ctx.text || "Nothing to echo." });
  },
};