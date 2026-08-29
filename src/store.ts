import NodeCache from "@cacheable/node-cache";
import type { CacheStore } from "@whiskeysockets/baileys";

export interface SentMessageIdStore {
  has: (id: string) => boolean;
  add: (id: string) => void;
}

export interface Stores {
  msgRetryCounterCache: CacheStore;
  groupCache: CacheStore;
  sentMessageIDs: SentMessageIdStore;
}

export function createStores(): Stores {
  const sentMessageCache = new NodeCache({
    stdTTL: 2 * 24 * 60 * 60, // 2 days
    useClones: false,
  });

  return {
    msgRetryCounterCache: new NodeCache() as CacheStore,
    groupCache: new NodeCache({ stdTTL: 5 * 60, useClones: false }) as CacheStore,
    sentMessageIDs: {
      has: (id: string) => sentMessageCache.has(id),
      add: (id: string) => {
        sentMessageCache.set(id, true);
      },
    },
  };
}