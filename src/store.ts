import NodeCache from "@cacheable/node-cache";
import type { CacheStore } from "@whiskeysockets/baileys";

export interface Stores {
  msgRetryCounterCache: CacheStore;
  groupCache: CacheStore;
  sentMessageIDs: Set<string>;
}

export function createStores(): Stores {
  return {
    msgRetryCounterCache: new NodeCache() as CacheStore,
    groupCache: new NodeCache({ stdTTL: 5 * 60, useClones: false }) as CacheStore,
    sentMessageIDs: new Set(),
  };
}