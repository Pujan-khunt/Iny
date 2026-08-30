/**
 * Iny Interactive Developer Terminal CLI
 *
 * Test and debug the Core RAG Engine directly in the terminal without WhatsApp!
 *
 * Run with: npm run chat
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { askIny, getSessionSources, resetSession } from "../src/core/index.js";
import { DEFAULT_RESPONSE_STYLE } from "../src/config.js";
import { initDb } from "../src/db/index.js";

async function main() {
  console.log("\n========================================================");
  console.log("  🤖 Iny - Interactive RAG Engine CLI (Developer Mode)");
  console.log("========================================================");
  console.log("📝 Logs routed to: logs/chat.log (run 'tail -f logs/chat.log' to follow)");
  console.log("Initializing database connection...\n");

  await initDb();

  const rl = readline.createInterface({ input, output });
  const sessionId = `cli-dev-${Date.now()}`;
  let currentStyle = DEFAULT_RESPONSE_STYLE;

  console.log("✅ Iny Engine Ready!");
  console.log(`🎨 Active Style: [${currentStyle.toUpperCase()}]`);
  console.log("Commands: 'sources' (citations), 'reset' (clear memory), '/style <concise|detailed>', 'exit' to quit.\n");

  while (true) {
    const query = await rl.question("👤 You: ");
    const trimmed = query.trim();

    if (!trimmed) continue;

    if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
      console.log("\nGoodbye! 👋\n");
      break;
    }

    if (trimmed.toLowerCase().startsWith("/style")) {
      const parts = trimmed.split(/\s+/);
      if (parts[1]) {
        currentStyle = parts[1].toLowerCase();
        console.log(`\n🎨 Response style switched to: [${currentStyle.toUpperCase()}]\n`);
      } else {
        console.log(`\n🎨 Current style: [${currentStyle.toUpperCase()}]. Usage: /style <concise|detailed>\n`);
      }
      continue;
    }

    if (trimmed.toLowerCase() === "reset") {
      resetSession(sessionId);
      console.log("\n🔄 Session memory reset.\n");
      continue;
    }

    if (trimmed.toLowerCase() === "sources") {
      const sources = getSessionSources(sessionId);
      if (sources.length === 0) {
        console.log("\n⚠️ No cached sources for the last response.\n");
      } else {
        console.log("\n📚 Cached Sources:");
        sources.forEach((s, idx) => {
          console.log(`\n[${idx + 1}] ${s.title} (p. ${s.pageStart}-${s.pageEnd})`);
          console.log(`Match: ${s.matchType ?? "semantic"} | Score: ${s.score.toFixed(4)}`);
          console.log(`Content: "${s.content.slice(0, 200)}..."`);
        });
        console.log("");
      }
      continue;
    }

    try {
      process.stdout.write("\n🤖 Iny is thinking (searching policies)...");
      const startTime = Date.now();

      const response = await askIny({
        sessionId,
        message: trimmed,
        style: currentStyle,
        metadata: {
          channel: "cli",
          userName: "Developer",
        },
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      process.stdout.write(`\r                                                  \r`);

      console.log(
        `🤖 Iny [${response.style.toUpperCase()}] (${elapsed}s | ${response.iterations} tool step${response.iterations > 1 ? "s" : ""}):`,
      );
      console.log(response.message);

      if (response.citations.length > 0) {
        console.log(`\n📖 Sources Referenced:`);
        response.citations.forEach((c) => {
          console.log(`   • ${c.title} (${c.pageString})`);
        });
      }
      console.log("\n" + "─".repeat(56) + "\n");
    } catch (error) {
      console.error("\n❌ Error:", error instanceof Error ? error.message : error, "\n");
    }
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error in CLI:", err);
  process.exit(1);
});
