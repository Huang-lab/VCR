import type { Assembly } from "@/lib/hgvs/types";
import type { PenetranceRecord } from "./types";

export interface Locus {
  chr: string;
  pos: number;
  ref?: string;
  alt?: string;
}

const ALLELE = "[ACGT]+|-";

/**
 * Pulls a genomic locus out of strings like "chr13:g.32340300G>T", "13:32340300"
 * or "13-32340300-GT-G". "-" marks an empty allele (VEP-style indels).
 * Returns undefined when the text is not a locus.
 */
export function parseLocus(text: string | undefined): Locus | undefined {
  if (!text) return undefined;
  const t = text.trim();
  const hgvs = new RegExp(`^(?:chr)?([0-9]{1,2}|X|Y|MT?):g\\.(\\d+)(?:(${ALLELE})>(${ALLELE}))?$`, "i").exec(t);
  if (hgvs) return { chr: hgvs[1].toUpperCase(), pos: Number(hgvs[2]), ref: hgvs[3]?.toUpperCase(), alt: hgvs[4]?.toUpperCase() };
  const plain = new RegExp(`^(?:chr)?([0-9]{1,2}|X|Y|MT?)[:\\-\\s](\\d+)(?:[:\\-\\s](${ALLELE})[:\\-\\s>](${ALLELE}))?$`, "i").exec(t);
  if (plain) return { chr: plain[1].toUpperCase(), pos: Number(plain[2]), ref: plain[3]?.toUpperCase(), alt: plain[4]?.toUpperCase() };
  return undefined;
}

/**
 * Does a record (VCF-style, indels anchored on a padding base) sit at a locus?
 * VEP-style deletions ("T>-") and insertions ("->A") drop the anchor base, so
 * they are compared after trimming it.
 */
function atLocus(r: PenetranceRecord, l: Locus): boolean {
  if (r.chr.toUpperCase() !== l.chr) return false;
  const ref = r.ref.toUpperCase();
  const alt = r.alt.toUpperCase();
  if (l.alt === "-" || l.ref === "-") {
    if (l.alt === "-" && ref.length > alt.length && ref.startsWith(alt)) {
      return r.pos + alt.length === l.pos && (!l.ref || ref.slice(alt.length) === l.ref);
    }
    if (l.ref === "-" && alt.length > ref.length && alt.startsWith(ref)) {
      return r.pos + ref.length === l.pos && (!l.alt || alt.slice(ref.length) === l.alt);
    }
    return false;
  }
  return r.pos === l.pos && (!l.ref || ref === l.ref) && (!l.alt || alt === l.alt);
}

export interface FindKeys {
  rsid?: string;
  locus?: Locus;
  /**
   * True when `locus` names the exact change the user asked for (an HGVS or
   * protein search). False when it only came from resolving an rsID: dbSNP gives
   * one rsID to every allele at a position, so that locus is just the first.
   */
  alleleSpecific?: boolean;
}

export interface FindResult {
  matches: PenetranceRecord[];
  by?: "rsid" | "locus";
  /**
   * Records under the searched variant's rsID that carry a different allele.
   * Data exists at the position, but not for the change that was searched.
   */
  otherAlleles?: PenetranceRecord[];
}

const isBase = (s?: string) => !!s && /^[ACGT]$/i.test(s);
const isSnv = (l: Locus) => isBase(l.ref) && isBase(l.alt);

/**
 * Records for a variant, matched by rsID first and by (GRCh38) locus otherwise.
 * When the searched allele is known, a multi-allelic rsID is narrowed to it.
 *
 * A search for one exact single-base change never borrows another allele's
 * records through a shared rsID: BRCA2 p.E1308K (G>A) and p.E1308* (G>T) share
 * rs80358638, and they are different variants. Indels can be written several
 * ways, so for those a miss may still be the same variant and the rsID's records
 * are kept.
 */
export function findRecords(records: PenetranceRecord[], keys: FindKeys): FindResult {
  const { locus } = keys;
  const allele = locus?.ref && locus.alt ? locus : undefined;
  let otherAlleles: PenetranceRecord[] | undefined;

  const rsid = keys.rsid?.toLowerCase();
  if (rsid) {
    const hit = records.filter((r) => r.rsid?.toLowerCase() === rsid);
    if (hit.length > 0) {
      const narrowed = allele ? hit.filter((r) => atLocus(r, allele)) : [];
      if (narrowed.length > 0) return { matches: narrowed, by: "rsid" };
      if (!(keys.alleleSpecific && allele && isSnv(allele))) return { matches: hit, by: "rsid" };
      otherAlleles = hit;
    }
  }
  if (locus) {
    const hit = records.filter((r) => atLocus(r, locus));
    if (hit.length > 0) return { matches: hit, by: "locus" };
  }
  return { matches: [], otherAlleles };
}

export interface ResolvedVariant {
  /** How the server classified the input: "rsid", "hgvsp", "hgvsc", "hgvsg", "short" and so on. */
  kind?: string;
  rsid?: string;
  /** Genomic name of the variant on the assembly that was searched. */
  hgvsg?: string;
  /** Genomic name on the other assembly, when the server could resolve it. */
  altAssemblyHgvsg?: string;
}

/**
 * The keys `findRecords` needs, from what was typed and what the server has
 * resolved so far. The data are GRCh38, so a position only counts on GRCh38.
 */
export function lookupKeys(query: string, assembly: Assembly, resolved: ResolvedVariant = {}): FindKeys {
  const q = query.trim();
  const typedRsid = /^rs\d+$/i.test(q);
  const byRsid = (resolved.kind ?? (typedRsid ? "rsid" : undefined)) === "rsid";
  let locus: Locus | undefined;
  if (assembly === "GRCh38") {
    locus = parseLocus(q) ?? parseLocus(resolved.hgvsg);
  } else if (!byRsid && resolved.kind !== "hgvsg") {
    // Typed coordinates would be GRCh37, so the GRCh38 position has to come from the
    // server's lookup on the other build. A typed genomic name has no such lookup:
    // the same coordinates read against GRCh38 would be a different place.
    locus = parseLocus(resolved.altAssemblyHgvsg);
  }
  return { rsid: typedRsid ? q : resolved.rsid, locus, alleleSpecific: !byRsid };
}
