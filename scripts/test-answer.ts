import { askWithContext } from "../src/rag/answer.js";

const answer = await askWithContext("What is the SEV policy?", { threshold: 0.25 });
console.log("Answer:", answer);