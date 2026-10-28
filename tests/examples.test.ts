import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classify } from "@/lib/hgvs/classify";
import { baselineFor } from "@/lib/penetrance/baseline";
import { EXAMPLE_GROUPS } from "@/lib/penetrance/examples";
import { findRecords, lookupKeys } from "@/lib/penetrance/lookup";
import { parsePenetranceCsv } from "@/lib/penetrance/parse";
import { compareToBaseline, wilsonInterval } from "@/lib/penetrance/stats";
import { hasRiskLevel, thresholdsFor } from "@/lib/penetrance/thresholds";

const META = { id: "t", label: "t", description: "t" };
const records = parsePenetranceCsv(readFileSync("public/data/etable4_penetrance.csv", "utf8"), META).records;

describe("cancer examples", () => {
  it("has two groups of at least two distinct examples", () => {
    expect(EXAMPLE_GROUPS.map((g) => g.tier)).toEqual(["much-higher", "moderately-higher"]);
    const queries = EXAMPLE_GROUPS.flatMap((g) => g.examples.map((e) => e.query));
    expect(new Set(queries).size).toBe(queries.length);
    for (const g of EXAMPLE_GROUPS) expect(g.examples.length).toBeGreaterThanOrEqual(2);
  });

  for (const group of EXAMPLE_GROUPS) {
    for (const ex of group.examples) {
      describe(`${ex.query} (${group.tier})`, () => {
        const rec = records.find((r) => r.rsid === ex.rsid && r.disease === ex.disease);

        it("has a record for the disease it is meant to show", () => {
          expect(rec).toBeDefined();
        });

        it("sits in its band and clearly above the published base rate", () => {
          const baseline = baselineFor(ex.disease)!;
          const { ratio, verdict } = compareToBaseline(rec!.pct, wilsonInterval(rec!.affected, rec!.carriers), baseline.pct);
          expect(ratio).toBeGreaterThanOrEqual(group.band.min);
          expect(ratio).toBeLessThan(group.band.max);
          expect(verdict).toBe("higher");
        });

        it("is the only allele under its rsID, so a match by rsID cannot borrow another allele's data", () => {
          const alleles = new Set(records.filter((r) => r.rsid === ex.rsid).map((r) => `${r.chr}:${r.pos}:${r.ref}>${r.alt}`));
          expect(alleles.size).toBe(1);
        });

        it("opens on the disease it names, which is the card's default for the variant", () => {
          // The card starts on the first record with any affected carriers.
          const first = records.filter((r) => r.rsid === ex.rsid).find((r) => r.affected > 0);
          expect(first?.disease).toBe(ex.disease);
        });

        it("parses as a gene and protein change that VEP can be asked about", () => {
          const c = classify(ex.query);
          expect(c.kind).toBe("hgvsp");
          expect(c.gene).toBeTruthy();
          expect(c.proteinLong).toMatch(/^p\.[A-Z][a-z]{2}\d+(?:[A-Z][a-z]{2}|Ter)$/);
        });
      });
    }
  }
});

describe("cancer examples and exact-allele matching", () => {
  it("every cancer example still matches its record when searched by its exact allele", () => {
    for (const { examples } of EXAMPLE_GROUPS) {
      for (const ex of examples) {
        const rec = records.find((r) => r.rsid === ex.rsid && r.disease === ex.disease)!;
        const keys = lookupKeys(ex.query, "GRCh38", {
          kind: "hgvsp",
          rsid: ex.rsid,
          hgvsg: `chr${rec.chr}:g.${rec.pos}${rec.ref}>${rec.alt}`,
        });
        const r = findRecords(records, keys);
        expect(r.matches.map((m) => m.id), ex.query).toContain(rec.id);
      }
    }
  });
});

describe("screening thresholds", () => {
  it("puts breast MRI at a 20% lifetime risk, matching ignoring case", () => {
    const [t] = thresholdsFor("Familial Cancer of Breast");
    expect(t.pct).toBe(20);
    expect(hasRiskLevel(t)).toBe(true);
    expect(t.source).toMatch(/ACS/);
    expect(t.source).toMatch(/NCCN/);
  });

  it("gives prostate cancer gene-based guidance rather than a risk level", () => {
    const [t] = thresholdsFor("Malignant tumor of prostate");
    expect(hasRiskLevel(t)).toBe(false);
    expect(t.advice).toMatch(/BRCA2/);
  });

  it("has nothing for diseases without a screening level", () => {
    expect(thresholdsFor("Brugada syndrome")).toEqual([]);
    expect(thresholdsFor("not a disease")).toEqual([]);
  });

  it("fills every field of every entry", () => {
    for (const disease of new Set(records.map((r) => r.disease))) {
      for (const t of thresholdsFor(disease)) {
        expect(t.label.length, disease).toBeGreaterThan(0);
        expect(t.source.length, disease).toBeGreaterThan(0);
        expect(t.advice.length, disease).toBeGreaterThan(0);
        if (hasRiskLevel(t)) expect(t.pct).toBeGreaterThan(0);
      }
    }
  });

  it("only calls carriers above or below the 20% level when their 95% range clears it", () => {
    const [t] = thresholdsFor("Familial cancer of breast");
    // 4 of 8: range 21% to 79%, entirely above.
    expect(compareToBaseline(50, wilsonInterval(4, 8), t.pct!).verdict).toBe("higher");
    // 4 of 32: range 5% to 28% includes 20%, so the data cannot say.
    expect(compareToBaseline(12.5, wilsonInterval(4, 32), t.pct!).verdict).toBe("similar");
    // 0 of 39: range 0% to 9%, entirely below.
    expect(compareToBaseline(0, wilsonInterval(0, 39), t.pct!).verdict).toBe("lower");
  });
});
