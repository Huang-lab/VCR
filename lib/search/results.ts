/**
 * Upstream status reporting shared by the search routes.
 * `complete: false` marks results a reader should not treat as exhaustive.
 */

export interface SourceStatus {
  complete: boolean;
  likelyRateLimited: boolean;
  likelyPartial: boolean;
  message?: string;
}

/**
 * Translate upstream diagnostics into the status the UI shows. `complete:false`
 * marks results a reader should not treat as an exhaustive search.
 */
export function buildStatusFromDiagnostics(
  diag: { likelyPartial: boolean; likelyRateLimited: boolean },
  source: "ClinVar",
): SourceStatus {
  if (diag.likelyRateLimited) {
    return {
      complete: false,
      likelyRateLimited: true,
      likelyPartial: true,
      message: `${source} may be incomplete due to NCBI rate limiting. Please retry shortly.`,
    };
  }
  if (diag.likelyPartial) {
    return {
      complete: false,
      likelyRateLimited: false,
      likelyPartial: true,
      message: `${source} may be incomplete due to temporary upstream errors.`,
    };
  }
  return { complete: true, likelyRateLimited: false, likelyPartial: false };
}

/** Status for a source whose search failed outright rather than partially. */
export function failedSourceStatus(source: "ClinVar"): SourceStatus {
  return {
    complete: false,
    likelyRateLimited: false,
    likelyPartial: true,
    message: `${source} search failed. The other sources below are unaffected; please retry.`,
  };
}

export function rateLimitedStatus(source: "ClinVar", retryAfterSec?: number): SourceStatus {
  return {
    complete: false,
    likelyRateLimited: true,
    likelyPartial: true,
    message: retryAfterSec
      ? `${source} request rate-limited. Retry in ${retryAfterSec}s.`
      : `${source} may be incomplete due to NCBI rate limiting. Please retry shortly.`,
  };
}
