import assert from "node:assert";
import {
  normalizeJid,
  cacheJidMapping,
  getCachedPnForLid,
  getCachedLidForPn,
  resolveUserJid,
  resolveMessageJids,
} from "../src/services/jid.js";
import { isAllowlisted, addToAllowlist, removeFromAllowlist } from "../src/repositories/allowlist.js";
import { isAdmin } from "../src/services/admin.js";
import { ADMIN_JIDS } from "../src/config.js";

async function runTests() {
  console.log("=== Testing JID Normalization ===");
  assert.strictEqual(normalizeJid("919712954459:0@s.whatsapp.net"), "919712954459@s.whatsapp.net");
  assert.strictEqual(normalizeJid("100038462169115:2@lid"), "100038462169115@lid");
  assert.strictEqual(normalizeJid("120363410305217773@g.us"), "120363410305217773@g.us");
  assert.strictEqual(normalizeJid(""), "");
  console.log("✓ Normalization passed");

  console.log("=== Testing Bidirectional Mapping Cache ===");
  const testPn = "919999999999@s.whatsapp.net";
  const testLid = "100099999999999@lid";
  cacheJidMapping(testPn, testLid);
  assert.strictEqual(getCachedPnForLid(testLid), testPn);
  assert.strictEqual(getCachedLidForPn(testPn), testLid);
  console.log("✓ Bidirectional mapping passed");

  console.log("=== Testing Mock Socket Resolution ===");
  const mockSocket: any = {
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid: string) => {
          if (lid.includes("100038462169115")) return "919712954459:0@s.whatsapp.net";
          return null;
        },
        getLIDForPN: async (pn: string) => {
          if (pn.includes("919712954459")) return "100038462169115:0@lid";
          return null;
        },
      },
    },
  };

  const resolved = await resolveUserJid(mockSocket, "100038462169115@lid");
  assert.strictEqual(resolved.pnJid, "919712954459@s.whatsapp.net");
  assert.strictEqual(resolved.lidJid, "100038462169115@lid");
  assert.ok(resolved.allJids.includes("919712954459@s.whatsapp.net"));
  assert.ok(resolved.allJids.includes("100038462169115@lid"));
  console.log("✓ Socket LID resolution passed");

  console.log("=== Testing Message JID Resolution (Addressing mode switch mid-chat) ===");
  const incomingLidMsg: any = {
    key: {
      remoteJid: "100038462169115@lid",
      id: "MSG123",
      fromMe: false,
    },
  };

  const jidInfo = await resolveMessageJids(mockSocket, incomingLidMsg);
  assert.strictEqual(jidInfo.remoteJid, "100038462169115@lid");
  assert.strictEqual(jidInfo.canonicalJid, "919712954459@s.whatsapp.net");
  assert.ok(jidInfo.allJids.includes("919712954459@s.whatsapp.net"));
  assert.ok(jidInfo.allJids.includes("100038462169115@lid"));
  console.log("✓ Message JID resolution passed");

  console.log("=== Testing Allowlist with LID and PN ===");
  // Add PN to allowlist
  await addToAllowlist(testPn, "test-runner", "Test User");

  // Verify that checking via the LID (which was mapped above) passes allowlist!
  assert.strictEqual(isAllowlisted(testLid), true);
  assert.strictEqual(isAllowlisted([testLid]), true);
  assert.strictEqual(isAllowlisted(testPn), true);

  // Clean up
  await removeFromAllowlist(testPn);
  assert.strictEqual(isAllowlisted(testPn), false);
  console.log("✓ Allowlist integration passed");

  console.log("=== Testing Admin check with candidate JIDs ===");
  const adminPn = Array.from(ADMIN_JIDS)[0] || "918490089630@s.whatsapp.net";
  const adminLid = "202898550042793@lid";
  cacheJidMapping(adminPn, adminLid);

  // Admin sending message via LID
  assert.strictEqual(isAdmin(adminLid), true);
  assert.strictEqual(isAdmin([adminLid]), true);
  assert.strictEqual(isAdmin("999999999999@s.whatsapp.net"), false);
  console.log("✓ Admin check integration passed");

  console.log("\nALL TESTS PASSED SUCCESSFULLY! 🎉");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
