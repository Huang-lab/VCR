import { describe, expect, it } from "vitest";
import { buildStatusFromDiagnostics, failedSourceStatus, rateLimitedStatus } from "@/lib/search/results";

describe("source status", () => {
  it("is complete when upstream reported no problems", () => {
    expect(buildStatusFromDiagnostics({ likelyPartial: false, likelyRateLimited: false }, "ClinVar").complete).toBe(true);
  });

  it("flags rate limiting ahead of generic partial results", () => {
    const s = buildStatusFromDiagnostics({ likelyPartial: true, likelyRateLimited: true }, "ClinVar");
    expect(s).toMatchObject({ complete: false, likelyRateLimited: true });
    expect(s.message).toMatch(/rate limiting/i);
  });

  it("flags partial results from upstream errors", () => {
    const s = buildStatusFromDiagnostics({ likelyPartial: true, likelyRateLimited: false }, "ClinVar");
    expect(s).toMatchObject({ complete: false, likelyRateLimited: false, likelyPartial: true });
  });

  it("describes failed and rate-limited sources", () => {
    expect(failedSourceStatus("ClinVar").message).toMatch(/failed/);
    expect(rateLimitedStatus("ClinVar", 12).message).toMatch(/12s/);
  });
});
