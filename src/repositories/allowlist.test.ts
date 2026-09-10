import { describe, it, expect, vi } from "vitest";
import { isAllowlisted, addAllowedJidToCache } from "./allowlist.js";

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({ allowedJids: {} }));
vi.mock("../services/jid.js", () => ({
  normalizeJid: vi.fn((j) => j.trim()),
  getCachedPnForLid: vi.fn(),
  getCachedLidForPn: vi.fn(),
  invalidateJidMapping: vi.fn(),
}));

describe("allowlist", () => {
  it("adds JID to cache and normalizes it", () => {
    addAllowedJidToCache("  user@s.whatsapp.net  ");
    expect(isAllowlisted("user@s.whatsapp.net")).toBe(true);
  });

  it("returns false for uncached JID", () => {
    expect(isAllowlisted("unknown@s.whatsapp.net")).toBe(false);
  });

  it("checks array of JIDs", () => {
    addAllowedJidToCache("user1@s.whatsapp.net");
    expect(isAllowlisted(["unknown@s.whatsapp.net", "user1@s.whatsapp.net"])).toBe(true);
  });

  it("propagates allowlist to mapped LID/PN forms and checks altJid", () => {
    addAllowedJidToCache("user2@s.whatsapp.net");
    expect(isAllowlisted("other@s.whatsapp.net", "user2@s.whatsapp.net")).toBe(true);
  });
});
