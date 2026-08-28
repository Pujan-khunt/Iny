import { runAgent } from "../src/services/agent.js";

async function testAgent() {
  console.log("=== Testing Agent Response for 'What are demerit points?' ===");
  try {
    const response = await runAgent("What are demerit points?");
    console.log("\nAgent Final Answer:\n-------------------");
    console.log(response);
    console.log("-------------------\n");
  } catch (err) {
    console.error("Agent error:", err);
  }
}

testAgent().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
