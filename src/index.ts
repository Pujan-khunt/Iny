import { createLogger } from "./logger.js";
import { startSock } from "./socket.js";
import { createStores } from "./store.js";

const logger = createLogger();
const stores = createStores();
void startSock(logger, stores);