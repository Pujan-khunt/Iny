import { glob } from "glob";
import { readFile } from "node:fs/promises";
import { ingestFile } from "../src/rag/ingest.js";

function parseArgs(args: string[]): { maxTokens: number } {
  const maxTokensArg = args.indexOf("--max-tokens");
  const maxTokens = maxTokensArg !== -1 ? parseInt(args[maxTokensArg + 1] ?? "500", 10) : 500;
  return { maxTokens };
}

async function main(): Promise<void> {
  const { maxTokens } = parseArgs(process.argv.slice(2));

  console.log(`Starting ingest with maxTokens=${maxTokens}, overlap=50`);

  const files = await glob("docs/*.pdf");

  if (files.length === 0) {
    console.log("No PDF files found in docs/");
    return;
  }

  console.log(`Found ${files.length} PDF(s) in docs/`);

  let totalChunks = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const file of files) {
    console.log(`\nProcessing: ${file}`);
    const buffer = await readFile(file);
    const result = await ingestFile(file, buffer, { maxTokens, overlapTokens: 50, sourceType: "document" });

    if (result.chunksCreated === 0) {
      console.log(`  ⏭  Unchanged (content hash match)`);
    } else {
      console.log(`  ✅  ${result.chunksCreated} chunks, ${result.tokens} tokens, $${result.costUsd.toFixed(6)}`);
      totalChunks += result.chunksCreated;
      totalTokens += result.tokens;
      totalCost += result.costUsd;
    }
  }

  console.log(`\n=== Ingest Complete ===`);
  console.log(`Total files processed: ${files.length}`);
  console.log(`Total chunks created: ${totalChunks}`);
  console.log(`Total tokens: ${totalTokens}`);
  console.log(`Estimated cost: $${totalCost.toFixed(6)}`);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});