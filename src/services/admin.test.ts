import { describe, it, expect, vi } from "vitest";
import { isAdmin } from "./admin.js";

vi.mock("../config.js", () => {
  return {
    ADMIN_JIDS: new Set(["admin1@s.whatsapp.net", "admin2@s.whatsapp.net"]),
    DATABASE_URL: "postgres://mock",
    COUNTRY_CODE: "91"
  };
});

vi.mock("./jid.js", () => {
  return {
    normalizeJid: (jid: string) => jid.replace(/:\d+@/, "@"),
    getCachedPnForLid: (lid: string) => {
      if (lid === "lid1@lid") return "admin1@s.whatsapp.net";
      return null;
    },
    getCachedLidForPn: (pn: string) => {
      if (pn === "admin2@s.whatsapp.net") return "lid2@lid";
      return null;
    },
  };
});

describe("isAdmin", () => {
  it("admin JID returns true", () => {
    expect(isAdmin("admin1@s.whatsapp.net")).toBe(true);
  });

  it("non-admin JID returns false", () => {
    expect(isAdmin("user@s.whatsapp.net")).toBe(false);
  });

  it("array of JIDs where one is admin returns true", () => {
    expect(isAdmin(["user1@s.whatsapp.net", "admin2@s.whatsapp.net"])).toBe(true);
  });

  it("array of JIDs where none are admin returns false", () => {
    expect(isAdmin(["user1@s.whatsapp.net", "user2@s.whatsapp.net"])).toBe(false);
  });

  it("LID mapped to admin PN via cache returns true", () => {
    expect(isAdmin("lid1@lid")).toBe(true);
  });

  it("altJid parameter is checked", () => {
    expect(isAdmin("user@s.whatsapp.net", "admin1@s.whatsapp.net")).toBe(true);
    expect(isAdmin("user@s.whatsapp.net", "user2@s.whatsapp.net")).toBe(false);
  });

  it("empty input returns false", () => {
    expect(isAdmin("")).toBe(false);
    expect(isAdmin([])).toBe(false);
  });
});
