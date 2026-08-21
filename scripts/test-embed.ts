import { cosineSimilarity, OpenAIEmbeddingClient } from "../src/embeddings/client.js";
import { EMBEDDING_MODEL } from "../src/config.js";

const sentences = [
  "What is the placement policy for final year students?",
  "Tell me about the placement policy for final year",
  "What are the academic attendance requirements?",
  "How to make pasta?",
  "What is the reimbursement process for mess fees?",
];

async function main(): Promise<void> {
  console.log(`Model: ${EMBEDDING_MODEL}`);
  console.log(`Sentences: ${sentences.length}\n`);

  const client = new OpenAIEmbeddingClient();
  const vectors = await client.embedBatch(sentences);

  console.log(`Dimensions: ${vectors[0]?.length ?? 0}\n`);

  for (let i = 0; i < sentences.length; i++) {
    console.log(`[${i}] "${sentences[i]}"`);
  }

  console.log("\nCosine similarity matrix (higher = more similar):\n");

  const header = ["     ", ...sentences.map((_, i) => `[${i}]`.padStart(6))].join("");
  console.log(header);
  console.log("-".repeat(header.length));

  for (let i = 0; i < vectors.length; i++) {
    const row = [`[${i}] |`];
    for (let j = 0; j < vectors.length; j++) {
      const sim = cosineSimilarity(vectors[i]!, vectors[j]!);
      row.push(sim.toFixed(3).padStart(6));
    }
    console.log(row.join(""));
  }

  console.log("\nChecks:");
  const sim01 = cosineSimilarity(vectors[0]!, vectors[1]!);
  const sim03 = cosineSimilarity(vectors[0]!, vectors[3]!);
  const passParaphrase = sim01 > 0.8;
  const passUnrelated = sim03 < 0.4;
  console.log(`  [0] vs [1] (paraphrase) = ${sim01.toFixed(3)} — ${passParaphrase ? "PASS (>0.8)" : "FAIL (expected >0.8)"}`);
  console.log(`  [0] vs [3] (unrelated)  = ${sim03.toFixed(3)} — ${passUnrelated ? "PASS (<0.4)" : "FAIL (expected <0.4)"}`);
}

main().catch((error) => {
  console.error("test-embed failed:", error);
  process.exitCode = 1;
});
