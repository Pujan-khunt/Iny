import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within limit", () => {
    const limiter = createRateLimiter(3, 1000);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
  });

  it("blocks requests exceeding limit", () => {
    const limiter = createRateLimiter(3, 1000);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);
    expect(limiter.check("user1")).toBe(false);
  });

  it("prunes expired timestamps", () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false); // blocked

    // Advance by windowMs + 1
    vi.advanceTimersByTime(1001);

    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);
  });

  it("different keys are independent", () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);
    expect(limiter.check("user2")).toBe(true);
    expect(limiter.check("user2")).toBe(false);
  });

  it("window slides correctly over time", () => {
    const limiter = createRateLimiter(3, 1000);
    expect(limiter.check("user1")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);

    vi.advanceTimersByTime(501);
    // first request expired, so we can make 1 more
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);
  });
});
