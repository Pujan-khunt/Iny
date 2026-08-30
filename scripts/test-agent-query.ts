import { askIny } from "../src/core/index.js";

async function testAgent() {
  console.log("=== Testing Agent Response for 'What are demerit points?' ===");
  try {
    const response = await askIny({
      sessionId: "test-session",
      message: "What are demerit points?",
    });
    console.log("\nAgent Final Answer:\n-------------------");
    console.log(response.message);
    console.log("-------------------\n");
    console.log("Citations:", response.citations.map((c) => c.title));
  } catch (err) {
    console.error("Agent error:", err);
  }
}

testAgent().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
