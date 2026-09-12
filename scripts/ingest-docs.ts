import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ingestFile } from "../src/rag/ingest.js";

/**
 * Local development ingestion script.
 * Reads all .md files from docs/ and ingests them using the same
 * ingestFile() function that the /api/ingest endpoint uses.
 *
 * Usage: npm run ingest [-- --max-tokens <number>]
 */

function parseArgs(args: string[]): { maxTokens: number } {
  const maxTokensArg = args.indexOf("--max-tokens");
  const maxTokens = maxTokensArg !== -1 ? parseInt(args[maxTokensArg + 1] ?? "500", 10) : 500;
  return { maxTokens };
}

async function main(): Promise<void> {
  const { maxTokens } = parseArgs(process.argv.slice(2));

  console.log(`Starting ingest with maxTokens=${maxTokens}, overlap=50`);

  const docsDir = "docs";
  let entries: string[];
  try {
    entries = await readdir(docsDir);
  } catch {
    console.log(`No docs/ directory found. Create it and add .md files to ingest.`);
    return;
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md")).map((f) => join(docsDir, f));

  if (mdFiles.length === 0) {
    console.log("No .md files found in docs/");
    return;
  }

  console.log(`Found ${mdFiles.length} file(s) in docs/`);

  let totalChunks = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const file of mdFiles) {
    console.log(`\nProcessing: ${file}`);
    const buffer = await readFile(file);
    const result = await ingestFile(file, buffer, {
      maxTokens,
      overlapTokens: 50,
      sourceType: "document",
    });

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
  console.log(`Total files processed: ${mdFiles.length}`);
  console.log(`Total chunks created: ${totalChunks}`);
  console.log(`Total tokens: ${totalTokens}`);
  console.log(`Estimated cost: $${totalCost.toFixed(6)}`);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});