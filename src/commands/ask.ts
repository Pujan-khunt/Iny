import { addHistory, forgetFact, getHistory, listFacts, rememberFact } from "../repositories/aiMemory.js";
import { askQuestion } from "../services/ai.js";
import { createRateLimiter } from "../services/rateLimit.js";
import type { CommandContext } from "./types.js";

const ASK_RATE_LIMITER = createRateLimiter(5, 60_000);
const MAX_QUESTION_LENGTH = 2000;
const MAX_FACT_LENGTH = 500;

export const askCommand = {
  name: "ask",
  description: "Ask the assistant a question",
  usage: "/ask <question>",
  execute: async (ctx: CommandContext) => {
    if (!ctx.text) {
      await ctx.reply({ text: "Usage: /ask <question>" });
      return;
    }

    if (!ASK_RATE_LIMITER.check(ctx.jid)) {
      await ctx.reply({ text: "Too many questions — wait a minute and try again." });
      return;
    }

    const question = ctx.text.slice(0, MAX_QUESTION_LENGTH);

    try {
      const [facts, history] = await Promise.all([
        listFacts(ctx.jid),
        getHistory(ctx.jid, 10),
      ]);

      const answer = await askQuestion(question, facts, history);

      await Promise.all([
        addHistory(ctx.jid, "user", question),
        addHistory(ctx.jid, "assistant", answer),
      ]);

      await ctx.reply({ text: answer });
    } catch (error) {
      ctx.logger.error({ error }, "AI request failed");
      await ctx.reply({ text: "Sorry, I couldn't answer that right now. Try again in a moment." });
    }
  },
};

export const rememberCommand = {
  name: "remember",
  description: "Store a fact about yourself",
  usage: "/remember <fact>",
  execute: async (ctx: CommandContext) => {
    if (!ctx.text) {
      await ctx.reply({ text: "Usage: /remember <fact>" });
      return;
    }

    const fact = ctx.text.trim();

    if (fact.length > MAX_FACT_LENGTH) {
      await ctx.reply({ text: `That fact is too long — keep it under ${MAX_FACT_LENGTH} characters.` });
      return;
    }

    await rememberFact(ctx.jid, fact);
    await ctx.reply({ text: "Got it." });
  },
};

export const memoryCommand = {
  name: "memory",
  description: "Show the facts stored about you",
  execute: async (ctx: CommandContext) => {
    const facts = await listFacts(ctx.jid);

    if (facts.length === 0) {
      await ctx.reply({ text: "No facts stored yet. Use /remember <fact> to add one." });
      return;
    }

    await ctx.reply({ text: facts.map((fact) => `- ${fact}`).join("\n") });
  },
};

export const forgetCommand = {
  name: "forget",
  description: "Remove a stored fact",
  usage: "/forget <fact>",
  execute: async (ctx: CommandContext) => {
    if (!ctx.text) {
      await ctx.reply({ text: "Usage: /forget <fact>" });
      return;
    }

    const removed = await forgetFact(ctx.jid, ctx.text.trim());
    await ctx.reply({ text: removed ? "Forgotten." : "No such fact found." });
  },
};