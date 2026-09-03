import { describe, expect, it } from "vitest";
import { RateLimiter, mapWithLimiter } from "@/lib/entrez/scheduler";

/**
 * Track how many tasks are running at the same instant.
 *
 * A live counter is the only sound way to measure this: the limiter releases
 * each slot as its own task settles, so one slow task's start/end interval can
 * legitimately span several later batches. Comparing recorded intervals for
 * overlap therefore over-counts and is not a test of the concurrency cap.
 */
function concurrencyProbe() {
  let live = 0;
  let peak = 0;
  return {
    get peak() {
      return peak;
    },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      live += 1;
      peak = Math.max(peak, live);
      try {
        return await fn();
      } finally {
        live -= 1;
      }
    },
  };
}

describe("RateLimiter", () => {
  it("caps concurrency at the configured ceiling", async () => {
    const limiter = new RateLimiter({ ratePerSec: 1000, concurrency: 3, burst: 3 });
    const probe = concurrencyProbe();
    let completed = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.schedule(() =>
          probe.run(async () => {
            await new Promise((r) => setTimeout(r, 30));
            completed += 1;
          }),
        ),
      ),
    );
    expect(completed).toBe(12);
    expect(probe.peak).toBe(3);
  });

  it("runs a single task when concurrency is 1", async () => {
    const limiter = new RateLimiter({ ratePerSec: 1000, concurrency: 1, burst: 1 });
    const probe = concurrencyProbe();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        limiter.schedule(() => probe.run(() => new Promise((r) => setTimeout(r, 5)))),
      ),
    );
    expect(probe.peak).toBe(1);
  });

  it("holds the sustained rate below the configured requests per second", async () => {
    // 20 tokens/sec, burst 4: 24 instant tasks need >= (24-4)/20 = 1.0s.
    const limiter = new RateLimiter({ ratePerSec: 20, concurrency: 8, burst: 4 });
    const started: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 24 }, () =>
        limiter.schedule(async () => {
          started.push(Date.now() - t0);
        }),
      ),
    );
    const elapsed = Date.now() - t0;
    expect(started).toHaveLength(24);
    expect(elapsed).toBeGreaterThanOrEqual(950);

    // No 1-second window may contain more than burst + rate requests.
    for (const s of started) {
      const inWindow = started.filter((o) => o >= s && o < s + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(4 + 20);
    }
  });

  it("overlaps latency instead of accumulating it", async () => {
    // 12 tasks of 100ms each. Serial would be ~1200ms; at concurrency 6 the
    // rate budget (50/s, burst 6) is not the constraint, so expect ~200ms.
    const limiter = new RateLimiter({ ratePerSec: 50, concurrency: 6, burst: 6 });
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.schedule(() => new Promise((r) => setTimeout(r, 100))),
      ),
    );
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(600);
  });

  it("releases the concurrency slot when a task rejects", async () => {
    const limiter = new RateLimiter({ ratePerSec: 1000, concurrency: 2, burst: 2 });
    const failures = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        limiter.schedule(async () => {
          throw new Error("upstream boom");
        }),
      ),
    );
    expect(failures.every((f) => f.status === "rejected")).toBe(true);
    // A healthy task still gets through afterwards, proving no slot leaked.
    await expect(limiter.schedule(async () => "ok")).resolves.toBe("ok");
    expect(limiter.stats().inFlight).toBe(0);
  });

  it("consume() spends budget for calls made outside schedule()", async () => {
    const limiter = new RateLimiter({ ratePerSec: 5, concurrency: 4, burst: 4 });
    limiter.consume(4); // burn the whole burst, as a retry burst would
    const t0 = Date.now();
    await limiter.schedule(async () => "after");
    // At 5 tokens/sec a single token takes ~200ms to accrue.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
  });
});

describe("mapWithLimiter", () => {
  it("preserves input order regardless of completion order", async () => {
    const limiter = new RateLimiter({ ratePerSec: 1000, concurrency: 5, burst: 5 });
    const input = [50, 10, 40, 5, 30];
    const out = await mapWithLimiter(limiter, input, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:50", "1:10", "2:40", "3:5", "4:30"]);
  });

  it("returns an empty array for no tasks", async () => {
    const limiter = new RateLimiter({ ratePerSec: 10, concurrency: 2 });
    await expect(mapWithLimiter(limiter, [], async () => 1)).resolves.toEqual([]);
  });
});
