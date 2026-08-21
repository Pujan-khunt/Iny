import { initDb } from "./db/index.js";
import { createLogger } from "./logger.js";
import { initAllowlist } from "./repositories/allowlist.js";
import { startSock } from "./socket.js";
import { createStores } from "./store.js";

const logger = createLogger();
const stores = createStores();

async function main() {
  await initDb();
  await initAllowlist();
  await startSock(logger, stores);
}

void main().catch((error) => {
  logger.error({ error }, "Failed to start");
});