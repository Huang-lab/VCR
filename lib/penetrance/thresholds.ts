/**
 * Screening and other clinical action levels for the cancers in the bundled
 * penetrance data, so a carrier's risk can be read against the point where
 * guidelines change what is done, as well as against the general population.
 *
 * These are entered by hand from the cited guidelines and are meant for
 * orientation. Check the current guideline text before any clinical use.
 */
export interface ActionThreshold {
  /**
   * Lifetime risk (percent) at or above which the recommendation applies.
   * Absent when guidelines tie the action to specific genes, family history or
   * ancestry rather than to a risk level, as they do for prostate cancer.
   */
  pct?: number;
  /** Short name, used to label the level on a chart. */
  label: string;
  /** Who recommends it, as the subject of the sentence in `advice`. */
  source: string;
  /** What the source advises, continuing "{source} ...". */
  advice: string;
}

/** A threshold that has a risk level, so it can be drawn and compared. */
export type RiskLevelThreshold = ActionThreshold & { pct: number };

export const hasRiskLevel = (t: ActionThreshold): t is RiskLevelThreshold => t.pct !== undefined;

const THRESHOLDS: Record<string, ActionThreshold[]> = {
  "familial cancer of breast": [
    {
      pct: 20,
      label: "Annual breast MRI",
      source: "ACS, ACR and NCCN",
      advice: "advise adding a yearly breast MRI to mammography",
    },
  ],
  "malignant tumor of prostate": [
    {
      label: "Earlier PSA screening",
      source: "NCCN",
      advice: "recommends PSA screening from age 40 for BRCA2 carriers and suggests considering it for BRCA1 carriers",
    },
  ],
};

/** Screening and action thresholds for a disease, if any are on file. Matching ignores case. */
export function thresholdsFor(disease: string): ActionThreshold[] {
  return THRESHOLDS[disease.trim().toLowerCase()] ?? [];
}
