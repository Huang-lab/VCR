import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/hgvs/convert";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Step = (init: RequestInit | undefined) => Promise<unknown>;

/** Answers each call with the next step; the last step repeats. */
function stubFetch(...steps: Step[]) {
  let calls = 0;
  const mock = vi.fn((_url: string, init?: RequestInit) => steps[Math.min(calls++, steps.length - 1)](init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

const ok = (body: unknown): Step => async () => ({ ok: true, status: 200, json: async () => body });
const status = (code: number): Step => async () => ({ ok: false, status: code, json: async () => ({}) });
/** Never answers on its own, but rejects when its signal aborts, as a real fetch does. */
const hang: Step = (init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
/** Headers arrive, then the body stalls. */
const stalledBody: Step = async (init) => ({
  ok: true,
  status: 200,
  json: () =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }),
});

describe("fetchJson", () => {
  it("returns the parsed body on the first try", async () => {
    const mock = stubFetch(ok([{ id: "rs1" }]));
    await expect(fetchJson("https://example.test/vep")).resolves.toEqual([{ id: "rs1" }]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a call that never answers, within the total budget, instead of waiting for the platform to kill the function", async () => {
    const mock = stubFetch(hang);
    const started = Date.now();
    await expect(fetchJson("https://example.test/vep", undefined, 100)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("cuts a hung first try short so a second has time to answer", async () => {
    const mock = stubFetch(hang, ok({ id: "rs1" }));
    await expect(fetchJson("https://example.test/vep", undefined, 200)).resolves.toEqual({ id: "rs1" });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx and a network error", async () => {
    stubFetch(status(503), ok({ id: "a" }));
    await expect(fetchJson("https://example.test/vep")).resolves.toEqual({ id: "a" });
    stubFetch(async () => Promise.reject(new Error("network down")), ok({ id: "b" }));
    await expect(fetchJson("https://example.test/vep")).resolves.toEqual({ id: "b" });
  });

  it("tries only twice when the failure keeps happening", async () => {
    const mock = stubFetch(status(500));
    await expect(fetchJson("https://example.test/vep")).resolves.toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx, including a rate limit, which a second ask would not change", async () => {
    for (const code of [400, 404, 429]) {
      const mock = stubFetch(status(code), ok({ id: "never" }));
      await expect(fetchJson("https://example.test/vep")).resolves.toBeNull();
      expect(mock, String(code)).toHaveBeenCalledTimes(1);
    }
  });

  it("also bounds a body that stalls after the headers arrive", async () => {
    const mock = stubFetch(stalledBody);
    await expect(fetchJson("https://example.test/vep", undefined, 100)).resolves.toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("sends a signal and the identifying headers", async () => {
    const mock = stubFetch(ok({}));
    await fetchJson("https://example.test/vep");
    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({ Accept: "application/json" });
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^VCR\//);
  });
});
