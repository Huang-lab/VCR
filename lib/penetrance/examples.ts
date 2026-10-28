/**
 * Cancer examples for the search box, grouped by how far carriers sit above the
 * general-population rate in the bundled eTable 4 data.
 *
 * The bands follow the usual relative-risk bands for cancer predisposition
 * genes: moderate is about 2 to 4 times the population rate, high is 4 times or
 * more. Each example is also one where the card says "Above the published
 * general-population rate", meaning the base rate falls outside the carriers'
 * 95% range. tests/examples.test.ts checks both against the CSV.
 *
 * Every query is a gene and protein change that only one nucleotide substitution
 * can produce, and that Ensembl VEP resolves to the bundled record. Stop-gains
 * that two different substitutions can produce (BRCA2 p.L809*, p.Y1655*, p.Y3098*)
 * are left out: VEP timed out on them repeatedly when this list was chosen.
 */
export type RiskTier = "much-higher" | "moderately-higher";

export interface CancerExample {
  /** What the search box receives. */
  query: string;
  /** The disease in eTable 4 this example is chosen to show. */
  disease: string;
  /** Short disease name shown beside the chip. */
  cancer: string;
  /** rsID of the matching eTable 4 record. */
  rsid: string;
}

export interface ExampleGroup {
  tier: RiskTier;
  /** Heading for the group, with the band it stands for. */
  label: string;
  /** Lower bound (inclusive) and upper bound (exclusive) of carrier rate divided by base rate. */
  band: { min: number; max: number };
  examples: CancerExample[];
}

const BREAST = { disease: "Familial cancer of breast", cancer: "breast" } as const;
const PROSTATE = { disease: "Malignant tumor of prostate", cancer: "prostate" } as const;

export const EXAMPLE_GROUPS: ExampleGroup[] = [
  {
    tier: "much-higher",
    label: "Much higher risk (4x or more)",
    band: { min: 4, max: Infinity },
    examples: [
      { query: "BRCA2 p.E97*", ...PROSTATE, rsid: "rs397507646" },
      { query: "PALB2 p.Q251*", ...BREAST, rsid: "rs180177091" },
    ],
  },
  {
    tier: "moderately-higher",
    label: "Moderately higher risk (2 to 4x)",
    band: { min: 2, max: 4 },
    examples: [
      { query: "CHEK2 p.R519*", ...PROSTATE, rsid: "rs200432447" },
      { query: "BRCA2 p.E3002K", ...BREAST, rsid: "rs80359152" },
    ],
  },
];
