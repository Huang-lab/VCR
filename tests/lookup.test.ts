import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findRecords, lookupKeys, parseLocus } from "@/lib/penetrance/lookup";
import { parsePenetranceCsv } from "@/lib/penetrance/parse";
import type { PenetranceRecord } from "@/lib/penetrance/types";

const records = parsePenetranceCsv(readFileSync("public/data/etable4_penetrance.csv", "utf8"), {
  id: "t",
  label: "t",
  description: "t",
}).records;
const locus = (text: string) => parseLocus(text)!;
const alleles = (rs: PenetranceRecord[] = []) => [...new Set(rs.map((r) => `${r.ref}>${r.alt}`))];

// dbSNP gives rs80358638 to every substitution at chr13:32338277. eTable 4 holds
// c.3922G>T (p.E1308*); c.3922G>A (p.E1308K) is a different variant that shares the rsID.
const STOP_GAIN = locus("chr13:g.32338277G>T");
const MISSENSE = locus("chr13:g.32338277G>A");

describe("findRecords with a searched allele", () => {
  it("returns the record for the exact allele", () => {
    const r = findRecords(records, { rsid: "rs80358638", locus: STOP_GAIN, alleleSpecific: true });
    expect(alleles(r.matches)).toEqual(["G>T"]);
    expect(r.by).toBe("rsid");
    expect(r.otherAlleles).toBeUndefined();
  });

  it("does not borrow another allele's records through a shared rsID", () => {
    const r = findRecords(records, { rsid: "rs80358638", locus: MISSENSE, alleleSpecific: true });
    expect(r.matches).toEqual([]);
    expect(alleles(r.otherAlleles)).toEqual(["G>T"]);
  });

  it("still returns every allele under the rsID when the search was by rsID", () => {
    // The resolved locus is only the first allele dbSNP lists, not what the user asked for.
    const r = findRecords(records, { rsid: "rs80358638", locus: MISSENSE, alleleSpecific: false });
    expect(alleles(r.matches)).toEqual(["G>T"]);
    expect(r.by).toBe("rsid");
  });

  it("keeps the rsID's records for an indel, which can be written several ways", () => {
    // rs80359351 is two deletions. This one sits one base off both, so neither matches exactly.
    const r = findRecords(records, { rsid: "rs80359351", locus: locus("13:32337162:AAAC:-"), alleleSpecific: true });
    expect(r.matches).toHaveLength(2);
    expect(r.otherAlleles).toBeUndefined();
  });

  it("finds an exact allele that eTable 4 files under a different rsID", () => {
    const base = records.find((r) => r.rsid === "rs80358638")!;
    const other = { ...base, id: "other", rsid: "rs999", alt: "A" };
    const r = findRecords([base, other], { rsid: "rs80358638", locus: MISSENSE, alleleSpecific: true });
    expect(r.matches).toEqual([other]);
    expect(r.by).toBe("locus");
  });

  it("matches a position alone to every allele there", () => {
    const r = findRecords(records, { locus: locus("13:32338277"), alleleSpecific: true });
    expect(alleles(r.matches)).toEqual(["G>T"]);
    expect(r.by).toBe("locus");
  });
});

describe("lookupKeys", () => {
  it("treats a typed rsID as an rsID search, whichever allele the server resolved first", () => {
    const k = lookupKeys("rs80358638", "GRCh38", { kind: "rsid", rsid: "rs80358638", hgvsg: "chr13:g.32338277G>A" });
    expect(k.rsid).toBe("rs80358638");
    expect(k.alleleSpecific).toBe(false);
  });

  it("treats an rsID search as such before the server has answered", () => {
    expect(lookupKeys("RS80358638", "GRCh38")).toMatchObject({ rsid: "RS80358638", alleleSpecific: false });
  });

  it("treats a gene plus rsID as an rsID search", () => {
    const k = lookupKeys("BRCA2 rs80358638", "GRCh38", { kind: "rsid", rsid: "rs80358638", hgvsg: "chr13:g.32338277G>A" });
    expect(k.alleleSpecific).toBe(false);
    expect(k.rsid).toBe("rs80358638");
  });

  it("treats a protein search as allele-specific and uses the resolved genomic name", () => {
    const k = lookupKeys("BRCA2 p.E1308K", "GRCh38", { kind: "hgvsp", rsid: "rs80358638", hgvsg: "chr13:g.32338277G>A" });
    expect(k.alleleSpecific).toBe(true);
    expect(k.locus).toEqual(MISSENSE);
  });

  it("uses typed coordinates on GRCh38, before the server has answered", () => {
    const k = lookupKeys("chr13:g.32338277G>A", "GRCh38");
    expect(k.locus).toEqual(MISSENSE);
    expect(k.alleleSpecific).toBe(true);
  });

  it("on GRCh37 takes the GRCh38 position from the other-build lookup, never the GRCh37 one", () => {
    const k = lookupKeys("BRCA2 p.E1308K", "GRCh37", {
      kind: "hgvsp",
      rsid: "rs80358638",
      hgvsg: "chr13:g.32912414G>A",
      altAssemblyHgvsg: "chr13:g.32338277G>A",
    });
    expect(k.locus).toEqual(MISSENSE);
  });

  it("on GRCh37 has no position for an rsID search, a typed genomic name, or a failed lookup", () => {
    expect(lookupKeys("rs80358638", "GRCh37", { kind: "rsid", altAssemblyHgvsg: "chr13:g.32338277G>A" }).locus).toBeUndefined();
    expect(
      lookupKeys("chr13:g.32912414G>A", "GRCh37", { kind: "hgvsg", altAssemblyHgvsg: "chr13:g.32338277G>A" }).locus,
    ).toBeUndefined();
    expect(lookupKeys("BRCA2 p.E1308K", "GRCh37", { kind: "hgvsp", rsid: "rs80358638" }).locus).toBeUndefined();
  });
});

describe("searches end to end", () => {
  const search = (query: string, resolved: Parameters<typeof lookupKeys>[2]) =>
    findRecords(records, lookupKeys(query, "GRCh38", resolved));

  it("BRCA2 p.E1308K finds nothing, because only p.E1308* is in eTable 4", () => {
    const r = search("BRCA2 p.E1308K", { kind: "hgvsp", rsid: "rs80358638", hgvsg: "chr13:g.32338277G>A" });
    expect(r.matches).toEqual([]);
    expect(alleles(r.otherAlleles)).toEqual(["G>T"]);
  });

  it("BRCA2 p.E1308* finds the stop-gain", () => {
    const r = search("BRCA2 p.E1308*", { kind: "hgvsp", rsid: "rs80358638", hgvsg: "chr13:g.32338277G>T" });
    expect(alleles(r.matches)).toEqual(["G>T"]);
  });

  it("AR p.A871E finds nothing, and AR p.A871V finds the record that is there", () => {
    expect(search("AR p.A871E", { kind: "hgvsp", rsid: "rs143040492", hgvsg: "chrX:g.67723690C>A" }).matches).toEqual([]);
    expect(search("AR p.A871V", { kind: "hgvsp", rsid: "rs143040492", hgvsg: "chrX:g.67723690C>T" }).matches).toHaveLength(1);
  });

  it("CHEK2 p.R519*, a reverse-strand gene, matches once VEP's alleles are put on the forward strand", () => {
    // VEP reports C/T on strand -1; the forward-strand change is G>A.
    expect(search("CHEK2 p.R519*", { kind: "hgvsp", rsid: "rs200432447", hgvsg: "chr22:g.28687974G>A" }).matches).toHaveLength(1);
    // Read as written on the forward strand, the same alleles are a different variant.
    expect(search("CHEK2 p.R519*", { kind: "hgvsp", rsid: "rs200432447", hgvsg: "chr22:g.28687974C>T" }).matches).toEqual([]);
  });
});
