import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { forwardStrandAlleles, reverseComplement } from "@/lib/hgvs/convert";
import { findRecords } from "@/lib/penetrance/lookup";
import { parsePenetranceCsv } from "@/lib/penetrance/parse";

describe("reverseComplement", () => {
  it("complements and reverses", () => {
    expect(reverseComplement("C")).toBe("G");
    expect(reverseComplement("AAC")).toBe("GTT");
    expect(reverseComplement("acgt")).toBe("ACGT");
  });
  it("keeps an empty allele as '-'", () => {
    expect(reverseComplement("-")).toBe("-");
  });
});

describe("forwardStrandAlleles", () => {
  it("leaves alleles written on the forward strand alone", () => {
    expect(forwardStrandAlleles("G/T", 1)).toEqual({ ref: "G", alt: "T" });
    expect(forwardStrandAlleles("G/T", undefined)).toEqual({ ref: "G", alt: "T" });
  });

  it("flips alleles VEP wrote on the reverse strand", () => {
    expect(forwardStrandAlleles("C/T", -1)).toEqual({ ref: "G", alt: "A" });
  });

  it("flips indel alleles, including the empty one", () => {
    expect(forwardStrandAlleles("AAC/-", -1)).toEqual({ ref: "GTT", alt: "-" });
    expect(forwardStrandAlleles("-/AG", -1)).toEqual({ ref: "-", alt: "CT" });
  });

  it("returns nothing for a malformed allele string", () => {
    expect(forwardStrandAlleles("A", 1)).toBeUndefined();
    expect(forwardStrandAlleles("A/", 1)).toBeUndefined();
  });

  it("puts CHEK2 p.R519* (a reverse-strand gene) on the allele the penetrance data holds", () => {
    // VEP reports CHEK2:p.Arg519Ter at chr22:28687974 as "C/T" with strand -1.
    const records = parsePenetranceCsv(readFileSync("public/data/etable4_penetrance.csv", "utf8"), {
      id: "t",
      label: "t",
      description: "t",
    }).records;
    const { ref, alt } = forwardStrandAlleles("C/T", -1)!;
    const hit = findRecords(records, { locus: { chr: "22", pos: 28687974, ref, alt } });
    expect(hit.matches.map((r) => r.rsid)).toEqual(["rs200432447"]);
  });
});
