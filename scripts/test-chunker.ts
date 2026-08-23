import { readFile } from "node:fs/promises";
import { parsePdf } from "../src/rag/parser.js";
import { chunkText } from "../src/rag/chunker.js";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: npx tsx --env-file=.env scripts/test-chunker.ts <pdf-path>");
  process.exit(1);
}

const buffer = await readFile(filePath);
const doc = await parsePdf(buffer);

console.log(`File: ${filePath}`);
console.log(`Title: ${doc.title}`);
console.log(`Pages: ${doc.pages.length}`);
console.log(`Extracted: ${doc.fullText.length} chars, ${doc.fullText.split(/\s+/).length} words`);
console.log(`Preview (first 500 chars):\n${doc.fullText.slice(0, 500)}\n${"-".repeat(60)}\n`);

const chunks = chunkText(doc.pages, { maxTokens: 500, overlapTokens: 50 });

console.log(`Chunks: ${chunks.length}`);
let totalTokens = 0;
for (const c of chunks) totalTokens += c.tokenCount;
console.log(`Total tokens: ${totalTokens}, avg: ${(totalTokens / Math.max(1, chunks.length)).toFixed(1)}\n`);

for (let i = 0; i < Math.min(chunks.length, 3); i++) {
  const c = chunks[i]!;
  console.log(`--- Chunk ${c.chunkIndex} | tokens=${c.tokenCount} | pages=${c.pageStart}-${c.pageEnd} | headings=[${c.headings.join(" > ") || "none"}] ---`);
  console.log(c.content.slice(0, 800));
  console.log();
}

if (chunks.length > 3) {
  console.log(`... and ${chunks.length - 3} more chunks`);
}