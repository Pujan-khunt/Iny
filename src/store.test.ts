import { describe, it, expect } from "vitest";
import { createStores } from "./store.js";

describe("createStores", () => {
  it("sentMessageIDs.add and has work", () => {
    const stores = createStores();
    stores.sentMessageIDs.add("msg-1");
    expect(stores.sentMessageIDs.has("msg-1")).toBe(true);
  });

  it("has returns false for unknown IDs", () => {
    const stores = createStores();
    expect(stores.sentMessageIDs.has("unknown")).toBe(false);
  });

  it("multiple stores are independent", () => {
    const store1 = createStores();
    const store2 = createStores();
    store1.sentMessageIDs.add("msg-1");
    expect(store2.sentMessageIDs.has("msg-1")).toBe(false);
  });

  it("msgRetryCounterCache and groupCache exist", () => {
    const stores = createStores();
    expect(stores.msgRetryCounterCache).toBeDefined();
    expect(stores.groupCache).toBeDefined();
  });
});
