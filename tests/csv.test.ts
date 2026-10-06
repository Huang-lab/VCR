import { describe, expect, it } from "vitest";
import {
  clinvarToCsv,
  csvField,
  slugifyQuery,
  toCsv,
} from "@/lib/search/csv";

describe("csvField", () => {
  it("leaves simple values unquoted", () => {
    expect(csvField("V600E")).toBe("V600E");
    expect(csvField(12345)).toBe("12345");
  });

  it("quotes and escapes delimiters, quotes and newlines", () => {
    expect(csvField("Smith, J")).toBe('"Smith, J"');
    expect(csvField('He said "no"')).toBe('"He said ""no"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("renders empty for null and undefined", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("joins arrays with a semicolon", () => {
    expect(csvField(["V600E", "p.Val600Glu"])).toBe("V600E; p.Val600Glu");
    // A semicolon-joined list containing a comma still needs quoting.
    expect(csvField(["Smith, J", "Doe, R"])).toBe('"Smith, J; Doe, R"');
  });

  it("neutralizes leading characters spreadsheets treat as formulas", () => {
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("+V600E")).toBe("'+V600E");
    expect(csvField("-42")).toBe("'-42");
    expect(csvField("@import")).toBe("'@import");
    // A formula-leading value that also needs quoting gets both treatments.
    expect(csvField("=SUM(A1,A2)")).toBe('"\'=SUM(A1,A2)"');
  });
});

describe("toCsv", () => {
  it("emits a header row and CRLF line endings", () => {
    const csv = toCsv(["a", "b"], [[1, 2], [3, 4]]);
    expect(csv).toBe("a,b\r\n1,2\r\n3,4");
  });

  it("emits only the header when there are no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b");
  });
});

describe("clinvarToCsv", () => {
  it("includes classification, conditions and a record link", () => {
    const csv = clinvarToCsv([
      {
        uid: "13961",
        accession: "VCV000013961",
        title: "NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)",
        gene: "BRAF",
        clinicalSignificance: "Pathogenic",
        reviewStatus: "criteria provided, multiple submitters",
        lastEvaluated: "2023/01/01",
        conditions: ["Melanoma", "Cardiovascular phenotype"],
        matchedBy: ["BRAF V600E"],
      },
    ]);
    const row = csv.split("\r\n")[1];
    expect(row).toContain("VCV000013961");
    expect(row).toContain("Pathogenic");
    expect(row).toContain("Melanoma; Cardiovascular phenotype");
    expect(row).toContain("https://www.ncbi.nlm.nih.gov/clinvar/variation/13961/");
    // The title contains a comma-free but quote-free HGVS string; the review
    // status contains a comma and must be quoted.
    expect(row).toContain('"criteria provided, multiple submitters"');
  });
});

describe("slugifyQuery", () => {
  it("produces a filesystem-safe stem", () => {
    expect(slugifyQuery("BRAF p.V600E")).toBe("braf-p-v600e");
    expect(slugifyQuery("NM_004333.6:c.1799T>A")).toBe("nm-004333-6-c-1799t-a");
    expect(slugifyQuery("   ")).toBe("variant");
  });
});

/** Minimal RFC 4180 row parser, used to prove the writer's output is readable. */
function parseCsvRow(row: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}
