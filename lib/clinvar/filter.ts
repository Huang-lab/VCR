/**
 * Post-filter ClinVar records against the gene and alt amino acid the user
 * intended, to drop over-matches caused by:
 *
 *   1. Shared dbSNP rsIDs covering every alt allele at the same codon
 *      (e.g. rs121913529 → KRAS G12C/D/V/A/R/S).
 *   2. Non-gene-specific protein phrases that appear in paralogs
 *      (e.g. "p.Gly12Asp" in HRAS/NRAS).
 *
 * Strict mode: when we have both a gene and a set of protein forms, a record
 * must match BOTH. When only one signal is available we still enforce that
 * signal. When neither is available (pure rsID / bare HGVSg with no resolved
 * gene), we pass records through unchanged - there's nothing to validate.
 */

import type { ClinvarRecord } from "./entrez";

export interface ClinvarFilterContext {
  /** Gene symbol from the classified input or canonical variant. */
  gene?: string;
  /**
   * Every protein form to accept - mix of 1-letter (G12D, p.G12D) and
   * 3-letter (Gly12Asp, p.Gly12Asp). Caller should emit both.
   */
  proteinForms: string[];
}

export interface ClinvarFilterResult {
  kept: ClinvarRecord[];
  dropped: ClinvarRecord[];
}

function containsGene(haystack: string, gene: string): boolean {
  // Word-boundary match so "KRAS" doesn't match "KRASP1" pseudogene etc.
  const re = new RegExp(`\\b${escapeRegex(gene)}\\b`, "i");
  return re.test(haystack);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAnyProteinForm(title: string, forms: string[]): boolean {
  const t = title.toLowerCase();
  return forms.some((f) => f && t.includes(f.toLowerCase()));
}

export function filterClinvarRecords(
  records: ClinvarRecord[],
  ctx: ClinvarFilterContext,
): ClinvarFilterResult {
  const hasGene = !!ctx.gene;
  const hasForms = ctx.proteinForms.length > 0;

  // No validation signal available - pass everything through.
  if (!hasGene && !hasForms) {
    return { kept: records, dropped: [] };
  }

  const kept: ClinvarRecord[] = [];
  const dropped: ClinvarRecord[] = [];

  for (const r of records) {
    const title = r.title ?? "";
    const recGene = r.gene ?? "";

    // Gene check: record.gene equals OR title contains the gene symbol.
    const genePass = hasGene
      ? recGene.toLowerCase() === ctx.gene!.toLowerCase() ||
        containsGene(title, ctx.gene!)
      : true;

    // Protein-form check: title must contain one of the accepted forms.
    const proteinPass = hasForms ? matchesAnyProteinForm(title, ctx.proteinForms) : true;

    if (genePass && proteinPass) {
      kept.push(r);
    } else {
      dropped.push(r);
    }
  }

  return { kept, dropped };
}

/**
 * Build the set of protein forms to pass in the filter context. Accepts any
 * number of `proteinShort` / `proteinLong` strings (from the classified input
 * and from each VEP consequence) and emits a de-duped array covering:
 *   - bare short (G12D) and `p.` prefixed (p.G12D)
 *   - bare long (Gly12Asp) and `p.` prefixed (p.Gly12Asp)
 */
export function buildProteinForms(
  shorts: (string | undefined)[],
  longs: (string | undefined)[],
): string[] {
  const out = new Set<string>();
  for (const s of shorts) {
    if (!s) continue;
    const bare = s.replace(/^p\./i, "");
    if (bare) {
      out.add(bare);
      out.add(`p.${bare}`);
    }
  }
  for (const l of longs) {
    if (!l) continue;
    const bare = l.replace(/^p\./i, "");
    if (bare) {
      out.add(bare);
      out.add(`p.${bare}`);
    }
  }
  return Array.from(out);
}
