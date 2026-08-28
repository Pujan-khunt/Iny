import { retrieveTopK } from "../src/rag/retrieve.js";

async function testRetrieval() {
  console.log("=== Testing Hybrid Retrieval with 'What are demerit points?' ===");
  try {
    const results = await retrieveTopK("What are demerit points?", { topK: 5 });
    console.log(`Retrieved ${results.length} chunks:`);
    for (const [i, r] of results.entries()) {
      console.log(`\n--- Result #${i + 1} ---`);
      console.log(`Title: ${r.title} (p.${r.pageStart}-${r.pageEnd})`);
      console.log(`Match Type: ${r.matchType}`);
      console.log(`Scores -> RRF: ${r.score}, Sim: ${r.simScore}, Text: ${r.textScore}`);
      console.log(`Snippet: ${r.content.slice(0, 180)}...`);
    }

    if (results.length > 0) {
      console.log("\n✓ Hybrid retrieval succeeded in finding relevant chunks!");
    } else {
      console.log("\nNote: 0 chunks found. If the database was not ingested, make sure `npm run ingest` has been run.");
    }
  } catch (err) {
    console.error("Retrieval test error:", err);
  }
}

testRetrieval().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
