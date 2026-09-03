import assert from "node:assert";
import { markAsRead, setReaction, startTypingHeartbeat, withProgressUx } from "../src/services/chatUx.js";
import { createStores } from "../src/store.js";
import { addAllowedJidToCache } from "../src/repositories/allowlist.js";

async function runTests() {
  console.log("=== Testing Chat UX Functions ===");

  const testJid = "919876543210@s.whatsapp.net";
  addAllowedJidToCache(testJid);

  const key = {
    remoteJid: testJid,
    id: "MSG_001",
    fromMe: false,
  };

  // 1. Test markAsRead
  let readKeys: any[] = [];
  const mockSocket: any = {
    readMessages: async (keys: any[]) => {
      readKeys = keys;
    },
    sendMessage: async (jid: string, content: any, options: any) => {
      return { key: { id: "REPLY_001", remoteJid: jid } };
    },
    sendPresenceUpdate: async (type: string, jid: string) => {},
  };

  await markAsRead(mockSocket, key);
  assert.strictEqual(readKeys.length, 1);
  assert.strictEqual(readKeys[0].id, "MSG_001");
  console.log("✓ markAsRead passed");

  // 2. Test setReaction
  const stores = createStores();
  let sentContent: any = null;
  mockSocket.sendMessage = async (jid: string, content: any) => {
    sentContent = content;
    return { key: { id: "REACT_001", remoteJid: jid } };
  };

  await setReaction(mockSocket, stores, testJid, key, "⏳", [testJid]);
  assert.deepStrictEqual(sentContent, { react: { text: "⏳", key } });
  assert.ok(stores.sentMessageIDs.has("REACT_001"));
  console.log("✓ setReaction passed");

  // 3. Test startTypingHeartbeat
  const presenceUpdates: { type: string; jid: string }[] = [];
  mockSocket.sendPresenceUpdate = async (type: string, toJid: string) => {
    presenceUpdates.push({ type, jid: toJid });
  };

  const stopTyping = startTypingHeartbeat(mockSocket, testJid, undefined, 50);
  assert.strictEqual(presenceUpdates.length, 1);
  assert.strictEqual(presenceUpdates[0]?.type, "composing");

  await new Promise((r) => setTimeout(r, 120));
  assert.ok(presenceUpdates.length >= 2, "Heartbeat should have fired at least once more");

  stopTyping();
  assert.strictEqual(presenceUpdates[presenceUpdates.length - 1]?.type, "paused");
  console.log("✓ startTypingHeartbeat passed");

  // 4. Test withProgressUx
  const reactions: string[] = [];
  mockSocket.sendMessage = async (jid: string, content: any) => {
    if (content.react) {
      reactions.push(content.react.text);
    }
    return { key: { id: `MSG_${reactions.length}`, remoteJid: jid } };
  };

  let actionRan = false;
  const result = await withProgressUx(
    mockSocket,
    stores,
    testJid,
    key,
    [testJid],
    undefined,
    async () => {
      actionRan = true;
      return "done!";
    },
    { reactionEmoji: "⏳", typingIntervalMs: 50 }
  );

  assert.strictEqual(actionRan, true);
  assert.strictEqual(result, "done!");
  assert.deepStrictEqual(reactions, ["⏳", ""]);
  console.log("✓ withProgressUx success lifecycle passed");

  // 5. Test withProgressUx on error
  reactions.length = 0;
  let caughtError = false;
  try {
    await withProgressUx(
      mockSocket,
      stores,
      testJid,
      key,
      [testJid],
      undefined,
      async () => {
        throw new Error("Simulated failure");
      },
      { reactionEmoji: "⏳", typingIntervalMs: 50 }
    );
  } catch (err: any) {
    caughtError = true;
    assert.strictEqual(err.message, "Simulated failure");
  }
  assert.strictEqual(caughtError, true);
  assert.deepStrictEqual(reactions, ["⏳", ""]);
  console.log("✓ withProgressUx error lifecycle cleanup passed");

  console.log("\nAll UX unit tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
