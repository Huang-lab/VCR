/**
 * Search-term construction: turn one expanded variant into the phrase list
 * that goes to ClinVar.
 *
 * It is pure string logic over the expansion result, so it is unit-tested and
 * reusable by the server.
 */

import type { Assembly, ClassifiedInput, CanonicalVariant } from "@/lib/hgvs/types";
import { proteinFormsFor } from "@/lib/clinvar/forms";
import type { VariantGroups, VariantString } from "@/lib/hgvs/enumerate";

export interface ExpansionResult {
  input: string;
  assembly: Assembly;
  classified: ClassifiedInput;
  canonical: CanonicalVariant;
  groups: VariantGroups;
  variants: VariantString[];
}

/** Max phrases sent to one upstream database. Each phrase costs a request. */
export const MAX_SEARCH_TERMS = 50;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary gene match, so KRAS does not match KRASP1. */
export function hasGeneSymbol(term: string, gene?: string): boolean {
  if (!gene) return false;
  return new RegExp(`\\b${escapeRegex(gene)}\\b`, "i").test(term);
}

/** Every enumerated representation, de-duplicated, in group order. */
export function collectVariants(expand: ExpansionResult): string[] {
  const out = new Set<string>();
  const add = (v: VariantString) => {
    const t = v.text?.trim();
    if (t) out.add(t);
  };
  expand.groups.universal.forEach(add);
  for (const group of expand.groups.perTranscript) group.variants.forEach(add);
  expand.groups.fallback.forEach(add);
  return Array.from(out);
}

/**
 * Protein forms for ClinVar's structured query and post-filter: 1-letter and
 * 3-letter, each with and without the `p.` prefix.
 */
export function buildProteinForms(expand: ExpansionResult): string[] {
  const out = new Set<string>();
  const push = (s?: string) => {
    if (s) for (const f of proteinFormsFor(s)) out.add(f);
  };
  push(expand.classified.proteinShort);
  push(expand.classified.proteinLong);
  for (const c of expand.canonical.consequences) {
    push(c.proteinShort);
    push(c.proteinLong);
  }
  return Array.from(out);
}

/** The gene symbol to trust: resolved by VEP if available, else as typed. */
export function resolveGene(expand: ExpansionResult): string | undefined {
  return expand.canonical.gene ?? expand.classified.gene;
}

/** Trim, de-duplicate and cap a phrase list before it reaches an upstream API. */
export function normalizeTerms(terms: unknown, limit = MAX_SEARCH_TERMS): string[] {
  if (!Array.isArray(terms)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}
