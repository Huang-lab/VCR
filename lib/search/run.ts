/**
 * The search operations behind the API routes.
 *
 * Keeping these here (rather than inline in each route) keeps the Entrez
 * rate-limit budget in one process and makes the search testable.
 */

import type { EntrezConfig } from "@/lib/entrez/base";
import { searchClinvarForVariantsDetailed } from "@/lib/clinvar/entrez";
import { filterClinvarRecords } from "@/lib/clinvar/filter";
import type { ClinvarRecord } from "@/lib/clinvar/entrez";
import { SourceStatus, buildStatusFromDiagnostics, failedSourceStatus } from "@/lib/search/results";

export interface ClinvarPayload {
  count: number;
  unfilteredCount: number;
  gene?: string;
  proteinForms: string[];
  status: SourceStatus;
  records: ClinvarRecord[];
}

export function entrezConfigFromEnv(): EntrezConfig {
  return {
    apiKey: process.env.NCBI_API_KEY,
    email: process.env.NCBI_EMAIL,
    tool: "vcr",
  };
}

export function failedClinvarPayload(
  gene: string | undefined,
  proteinForms: string[],
): ClinvarPayload {
  return {
    count: 0,
    unfilteredCount: 0,
    gene,
    proteinForms,
    status: failedSourceStatus("ClinVar"),
    records: [],
  };
}

/** Search ClinVar, then drop records that do not match the intended gene/protein. */
export async function runClinvarSearch(
  variants: string[],
  cfg: EntrezConfig,
  opts: { gene?: string; proteinForms: string[] },
): Promise<ClinvarPayload> {
  const searchRes = await searchClinvarForVariantsDetailed(variants, cfg, {
    gene: opts.gene,
    proteinForms: opts.proteinForms,
  });
  const all = searchRes.records;
  const { kept } = filterClinvarRecords(all, {
    gene: opts.gene,
    proteinForms: opts.proteinForms,
  });

  return {
    count: kept.length,
    unfilteredCount: all.length,
    gene: opts.gene,
    proteinForms: opts.proteinForms,
    status: buildStatusFromDiagnostics(searchRes.diagnostics, "ClinVar"),
    records: kept,
  };
}
