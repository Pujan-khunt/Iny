export interface RateLimiter {
  check: (key: string) => boolean;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const timestamps = new Map<string, number[]>();

  function prune(key: string, now: number): number[] {
    const list = timestamps.get(key) ?? [];
    const cutoff = now - windowMs;
    const recent = list.filter((timestamp) => timestamp > cutoff);

    if (recent.length === 0) {
      timestamps.delete(key);
    } else {
      timestamps.set(key, recent);
    }

    return recent;
  }

  return {
    check(key: string): boolean {
      const now = Date.now();
      const recent = prune(key, now);

      if (recent.length >= limit) {
        return false;
      }

      recent.push(now);
      timestamps.set(key, recent);
      return true;
    },
  };
}