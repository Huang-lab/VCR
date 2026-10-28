import { envNumber } from "@/lib/entrez/scheduler";
import { AA1_TO_3, AA3_TO_1, Assembly, CanonicalVariant, ClassifiedInput, Consequence } from "./types";

/**
 * Thin wrappers over the public hosted services that together replace TransVar's
 * HGVSp ↔ HGVSc ↔ HGVSg conversions:
 *
 *   - Ensembl VEP REST (/vep/human/hgvs/{hgvs}) for all cross-conversions + rsIDs
 *   - Mutalyzer (/normalize/{hgvs}) for HGVS normalization/validation
 *   - NCBI Variation Services for RefSeq-aware HGVS parsing (fills VEP gaps)
 *
 * Each function is defensive - on failure, returns a partial result and the caller
 * merges what it can. No single API needs to succeed for the app to return something
 * useful.
 */

const USER_AGENT = "VCR/0.1 (https://labs.icahn.mssm.edu/kuanhuanglab/)";

/**
 * Longest a single resolver call may take in total, retry included. Ensembl
 * sometimes accepts a request and never answers (seen for some protein-level
 * queries), and without a limit the search would sit there until the platform
 * killed the function and the user got no result at all. A call that runs out of
 * time returns null like any other failure, so the search carries on with what
 * it has.
 *
 * Twenty seconds: lookups were seen taking 10 to 56 seconds, or failing with a
 * 5xx, in a slow period when most took under two seconds, and the next try of the
 * same lookup usually came back fast. A longer wait would eat the time ClinVar
 * needs inside the function budget (see SOFT_DEADLINE_MS in the search route).
 */
const REQUEST_TIMEOUT_MS = envNumber("ENSEMBL_TIMEOUT_MS", 20000);

/** Share of the budget the first try may use, so a try that hangs still leaves time for a second. */
const FIRST_TRY_SHARE = 0.4;

function vepBase(assembly: Assembly): string {
  if (assembly === "GRCh37") return "https://grch37.rest.ensembl.org";
  // GRCh38 and T2T both use the main REST endpoint (T2T is a best-effort remap below)
  return "https://rest.ensembl.org";
}

type Attempt<T> = { done: true; value: T | null } | { done: false };

/**
 * One try. `done: false` means the failure looks transient (a timeout, a network
 * error or a 5xx), so trying again may work. A 4xx, including a rate limit, will
 * not change on a second ask and a retry would only add load.
 */
async function attempt<T>(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Attempt<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
        ...(init?.headers ?? {}),
      },
    });
    if (res.status >= 500) return { done: false };
    if (!res.ok) return { done: true, value: null };
    return { done: true, value: (await res.json()) as T };
  } catch {
    return { done: false };
  }
}

/**
 * GET JSON from a resolver, with at most one retry of a transient failure, inside
 * `totalMs` overall. Returns null when it cannot get an answer in time.
 */
export async function fetchJson<T>(url: string, init?: RequestInit, totalMs = REQUEST_TIMEOUT_MS): Promise<T | null> {
  const deadline = Date.now() + totalMs;
  const first = await attempt<T>(url, init, Math.round(totalMs * FIRST_TRY_SHARE));
  if (first.done) return first.value;
  const left = deadline - Date.now();
  if (left <= 0) return null;
  const second = await attempt<T>(url, init, left);
  return second.done ? second.value : null;
}

// ---------- Ensembl VEP ----------

interface VepColocated {
  id?: string; // rsID
  seq_region_name?: string;
  start?: number;
  allele_string?: string;
}

interface VepTranscriptConsequence {
  gene_symbol?: string;
  transcript_id?: string;
  protein_id?: string;
  hgvsc?: string;
  hgvsp?: string;
  consequence_terms?: string[];
  amino_acids?: string; // "V/E"
  protein_start?: number;
  mane_select?: string;
  mane_plus_clinical?: string;
  canonical?: number | boolean;
}

interface VepResult {
  input?: string;
  seq_region_name?: string;
  start?: number;
  end?: number;
  /** Strand `allele_string` is written on: -1 for an HGVS name against a reverse-strand transcript. */
  strand?: number;
  allele_string?: string; // "T/A"
  id?: string;
  colocated_variants?: VepColocated[];
  transcript_consequences?: VepTranscriptConsequence[];
}

export async function vepLookupHgvs(
  hgvs: string,
  assembly: Assembly,
): Promise<VepResult | null> {
  // VEP wants the whole HGVS string URL-encoded
  const url = `${vepBase(assembly)}/vep/human/hgvs/${encodeURIComponent(hgvs)}?hgvs=1&refseq=1&xref_refseq=1&protein=1&mane=1&canonical=1&content-type=application/json`;
  const arr = await fetchJson<VepResult[]>(url);
  if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
  return arr[0];
}

// ---------- Mutalyzer ----------

interface MutalyzerNormalize {
  normalized_description?: string;
  equivalent_descriptions?: Record<string, string[]>; // { "p": [...], "c": [...], "g": [...] }
  errors?: { code: string; details: string }[];
}

export async function mutalyzerNormalize(
  hgvs: string,
): Promise<MutalyzerNormalize | null> {
  // v3 API: https://mutalyzer.nl/api/normalize/{hgvs}
  const url = `https://mutalyzer.nl/api/normalize/${encodeURIComponent(hgvs)}`;
  return await fetchJson<MutalyzerNormalize>(url);
}

// ---------- NCBI Variation Services ----------

interface NcbiVar {
  // The API returns a SPDI/VRS-ish structure; we only care about a few fields here.
  data?: {
    spdis?: { seq_id: string; position: number; deleted_sequence: string; inserted_sequence: string }[];
    hgvs?: string[];
  };
}

export async function ncbiHgvsToVariant(hgvs: string, assembly: Assembly): Promise<NcbiVar | null> {
  const assemblyParam = assembly === "GRCh37" ? "GCF_000001405.25" : "GCF_000001405.40";
  const url = `https://api.ncbi.nlm.nih.gov/variation/v0/hgvs/${encodeURIComponent(hgvs)}/contextuals?assembly=${assemblyParam}`;
  return await fetchJson<NcbiVar>(url);
}

// ---------- dbSNP rsID → HGVS ----------

export async function dbsnpRsToVariant(rsid: string, assembly: Assembly): Promise<VepResult | null> {
  // VEP supports rsID lookup via /vep/human/id/{rsid}
  const id = rsid.startsWith("rs") ? rsid : `rs${rsid}`;
  const url = `${vepBase(assembly)}/vep/human/id/${encodeURIComponent(id)}?hgvs=1&refseq=1&protein=1&mane=1&canonical=1&content-type=application/json`;
  const arr = await fetchJson<VepResult[]>(url);
  if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
  return arr[0];
}

// ---------- Strand ----------

const COMPLEMENT: Record<string, string> = { A: "T", C: "G", G: "C", T: "A", N: "N", "-": "-" };

/** Reverse complement of a nucleotide string. "-" (an empty allele) stays "-". */
export function reverseComplement(seq: string): string {
  return [...seq.toUpperCase()]
    .reverse()
    .map((base) => COMPLEMENT[base] ?? base)
    .join("");
}

/**
 * Reference and alternate allele from VEP's "REF/ALT", on the forward strand.
 *
 * VEP writes `allele_string` on the strand of the input. For an HGVS name
 * written against a reverse-strand transcript (CHEK2, BRCA1, TP53, ...) that is
 * -1, so the alleles are the complement of what the genome reference holds.
 * HGVSg and the penetrance lookup both use the forward strand.
 */
export function forwardStrandAlleles(
  alleleString: string,
  strand: number | undefined,
): { ref: string; alt: string } | undefined {
  const [ref, alt] = alleleString.split("/");
  if (!ref || !alt) return undefined;
  return strand === -1 ? { ref: reverseComplement(ref), alt: reverseComplement(alt) } : { ref, alt };
}

// ---------- Canonicalization orchestrator ----------

/**
 * Given a classified input, produce a CanonicalVariant by calling the most
 * appropriate upstream services. Each upstream is best-effort; we merge what we get.
 */
export async function canonicalize(
  input: ClassifiedInput,
  assembly: Assembly,
): Promise<CanonicalVariant> {
  const notes: string[] = [];
  const consequences: Consequence[] = [];
  let chrom: string | undefined;
  let genomicPos: number | undefined;
  let refAllele: string | undefined;
  let altAllele: string | undefined;
  let rsid: string | undefined;
  let gene: string | undefined = input.gene;
  let hgvsg: string | undefined;

  // Build the HGVS string to feed VEP. If the user gave a short form we
  // need the gene + short protein to make something VEP understands.
  const vepInput = buildVepInput(input);

  let vep: VepResult | null = null;
  if (input.kind === "rsid") {
    vep = await dbsnpRsToVariant(input.body, assembly);
  } else if (vepInput) {
    vep = await vepLookupHgvs(vepInput, assembly);
  }

  if (vep) {
    if (vep.seq_region_name) chrom = vep.seq_region_name;
    if (typeof vep.start === "number") genomicPos = vep.start;
    const alleles = vep.allele_string ? forwardStrandAlleles(vep.allele_string, vep.strand) : undefined;
    if (alleles) {
      refAllele = alleles.ref;
      altAllele = alleles.alt;
    }
    const rsCo = vep.colocated_variants?.find((c) => c.id?.startsWith("rs"));
    if (rsCo?.id) rsid = rsCo.id;

    for (const tc of vep.transcript_consequences ?? []) {
      const cons: Consequence = {
        transcript: tc.transcript_id,
        proteinAccession: tc.protein_id,
        gene: tc.gene_symbol,
        hgvsc: tc.hgvsc,
        hgvsp: tc.hgvsp,
        consequenceTerms: tc.consequence_terms,
        maneSelect: tc.mane_select,
        manePlusClinical: tc.mane_plus_clinical,
        canonical: tc.canonical === 1 || tc.canonical === true,
      };
      // Derive short/long protein forms from hgvsp when present
      if (tc.hgvsp) {
        const parsed = parseHgvsp(tc.hgvsp);
        cons.proteinShort = parsed.short;
        cons.proteinLong = parsed.long;
      } else if (tc.amino_acids && typeof tc.protein_start === "number") {
        const [refAA, altAA] = tc.amino_acids.split("/");
        if (refAA && altAA) {
          cons.proteinShort = `${refAA}${tc.protein_start}${altAA}`;
          const refAA3 = AA1_TO_3[refAA];
          const altAA3 = AA1_TO_3[altAA];
          if (refAA3 && altAA3) {
            cons.proteinLong = `p.${refAA3}${tc.protein_start}${altAA3}`;
          }
        }
      }
      if (!gene && cons.gene) gene = cons.gene;
      consequences.push(cons);
    }

    if (chrom && genomicPos && refAllele && altAllele) {
      hgvsg = `chr${chrom}:g.${genomicPos}${refAllele}>${altAllele}`;
    }
  } else {
    notes.push("Ensembl VEP lookup failed or returned no data.");
  }

  return {
    input,
    assembly,
    gene,
    rsid,
    hgvsg,
    chrom,
    genomicPos,
    refAllele,
    altAllele,
    consequences,
    notes,
  };
}

/**
 * Canonicalize on the primary assembly AND on the alternate build in parallel,
 * so enumerated variants can include HGVSg for both GRCh38 and GRCh37. The
 * primary result is returned as-is; alternate-build coordinates are attached
 * via `altAssemblyCoords`. Transcript consequences are assembly-specific and
 * are only taken from the primary result.
 */
export async function canonicalizeMultiAssembly(
  input: ClassifiedInput,
  primaryAssembly: Assembly,
): Promise<CanonicalVariant> {
  const altAssembly: Assembly =
    primaryAssembly === "GRCh37" ? "GRCh38" : "GRCh37";
  const [primaryRes, altRes] = await Promise.allSettled([
    canonicalize(input, primaryAssembly),
    canonicalize(input, altAssembly),
  ]);

  if (primaryRes.status !== "fulfilled") {
    // Propagate the primary failure - callers already handle empty canonical
    // variants via the fallback bucket in enumerateGrouped.
    throw primaryRes.reason;
  }
  const primary = primaryRes.value;

  if (altRes.status === "fulfilled") {
    const alt = altRes.value;
    if (alt.chrom || alt.genomicPos || alt.hgvsg) {
      primary.altAssemblyCoords = {
        assembly: altAssembly,
        hgvsg: alt.hgvsg,
        chrom: alt.chrom,
        genomicPos: alt.genomicPos,
        refAllele: alt.refAllele,
        altAllele: alt.altAllele,
      };
    } else {
      primary.notes.push(
        `No coordinates resolved on ${altAssembly}; enumerated HGVSg is ${primaryAssembly} only.`,
      );
    }
  } else {
    primary.notes.push(
      `Alternate-build lookup (${altAssembly}) failed; enumerated HGVSg is ${primaryAssembly} only.`,
    );
  }

  return primary;
}

function buildVepInput(input: ClassifiedInput): string | null {
  switch (input.kind) {
    case "hgvsc":
    case "hgvsp":
    case "hgvsn":
      if (input.accession) return `${input.accession}:${input.body}`;
      // Gene-prefixed protein like BRAF:p.V600E - VEP accepts gene symbols for protein HGVS
      if (input.gene && /^p\./i.test(input.body)) return `${input.gene}:${input.body}`;
      return null;
    case "hgvsg":
      if (input.accession) return `${input.accession}:${input.body}`;
      if (input.chrom) {
        // VEP accepts chr:g.posREF>ALT; it normalizes to the right seq_region
        const c = input.chrom.replace(/^chr/i, "");
        return `${c}:${input.body}`;
      }
      return null;
    case "short":
      if (input.gene && input.proteinLong) return `${input.gene}:${input.proteinLong}`;
      if (input.gene && input.proteinShort) return `${input.gene}:p.${input.proteinShort}`;
      return null;
    default:
      return null;
  }
}

function parseHgvsp(hgvsp: string): { short?: string; long?: string } {
  // e.g. "NP_004324.2:p.Val600Glu" or "ENSP00000288602.7:p.Val600Glu"
  const body = hgvsp.split(":").pop() ?? hgvsp;
  const stripped = body.replace(/^p\./, "").replace(/^\(([^)]+)\)$/, "$1");
  const m = stripped.match(/^([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2}|Ter|\*|=|fs.*|del.*|dup.*|ins.*)?$/);
  if (!m) return { long: hgvsp };
  const [, ref3, pos, alt3] = m;
  const ref1 = AA3_TO_1[ref3];
  let alt1: string | undefined;
  if (alt3) {
    if (alt3 === "Ter" || alt3 === "*") alt1 = "*";
    else if (/^fs/.test(alt3) || /^(del|dup|ins)/.test(alt3) || alt3 === "=") alt1 = alt3;
    else alt1 = AA3_TO_1[alt3];
  }
  const short = ref1 && alt1 ? `${ref1}${pos}${alt1}` : ref1 ? `${ref1}${pos}` : undefined;
  const long = `p.${ref3}${pos}${alt3 ?? ""}`;
  return { short, long };
}
