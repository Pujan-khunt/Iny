import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeJid,
  cacheJidMapping,
  getCachedPnForLid,
  getCachedLidForPn,
  invalidateJidMapping,
} from "./jid.js";

describe("JID Service", () => {
  beforeEach(() => {
    // Clear caches if necessary, or just rely on distinct test data
    // Since we don't have an exposed clearCache(), we'll use unique JIDs per test
  });

  describe("normalizeJid", () => {
    it("returns empty string for null/undefined", () => {
      expect(normalizeJid(null)).toBe("");
      expect(normalizeJid(undefined)).toBe("");
    });

    it("removes device suffix from PN JIDs", () => {
      expect(normalizeJid("919876543210:5@s.whatsapp.net")).toBe("919876543210@s.whatsapp.net");
    });

    it("removes device suffix from LID JIDs", () => {
      expect(normalizeJid("123456789:12@lid")).toBe("123456789@lid");
    });

    it("leaves standard JIDs unchanged", () => {
      expect(normalizeJid("919876543210@s.whatsapp.net")).toBe("919876543210@s.whatsapp.net");
    });
  });

  describe("JID Caching", () => {
    it("caches bidirectional mapping", () => {
      const pn = "111@s.whatsapp.net";
      const lid = "222@lid";
      
      cacheJidMapping(pn, lid);

      expect(getCachedLidForPn(pn)).toBe(lid);
      expect(getCachedPnForLid(lid)).toBe(pn);
    });

    it("normalizes before caching", () => {
      const pn = "333:5@s.whatsapp.net";
      const lid = "444:10@lid";

      cacheJidMapping(pn, lid);

      // Retrieving with clean JIDs should work
      expect(getCachedLidForPn("333@s.whatsapp.net")).toBe("444@lid");
      expect(getCachedPnForLid("444@lid")).toBe("333@s.whatsapp.net");

      // Retrieving with dirty JIDs should also work (since getters also normalize)
      expect(getCachedLidForPn("333:2@s.whatsapp.net")).toBe("444@lid");
    });

    it("invalidates mapping correctly", () => {
      const pn = "555@s.whatsapp.net";
      const lid = "666@lid";

      cacheJidMapping(pn, lid);
      expect(getCachedLidForPn(pn)).toBe(lid);

      invalidateJidMapping(pn);

      expect(getCachedLidForPn(pn)).toBeUndefined();
      expect(getCachedPnForLid(lid)).toBeUndefined();
    });
  });
});
