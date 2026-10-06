"use client";

interface VariantString {
  text: string;
  label: string;
}

interface TranscriptGroup {
  gene?: string;
  transcript?: string;
  proteinAccession?: string;
  hgvsc?: string;
  hgvsp?: string;
  consequenceTerms?: string[];
  isManeSelect?: boolean;
  isManePlusClinical?: boolean;
  isCanonical?: boolean;
  maneSelectName?: string;
  variants: VariantString[];
}

interface VariantGroups {
  universal: VariantString[];
  perTranscript: TranscriptGroup[];
  fallback: VariantString[];
}

interface Props {
  data: {
    input: string;
    assembly: string;
    classified: { kind: string; gene?: string; accession?: string; body: string };
    canonical: {
      gene?: string;
      rsid?: string;
      hgvsg?: string;
      notes: string[];
      consequences: unknown[];
    };
    groups: VariantGroups;
    variants: VariantString[];
  };
}

function Chip({ v }: { v: VariantString }) {
  return (
    <span className="variant-chip" title={v.label}>
      <span className="label">{v.label}</span>
      {v.text}
    </span>
  );
}

function ChipList({ items }: { items: VariantString[] }) {
  if (items.length === 0) {
    return <div className="muted-small">(none)</div>;
  }
  return (
    <div className="variant-list">
      {items.map((v) => (
        <Chip key={v.text} v={v} />
      ))}
    </div>
  );
}

function GroupHeader({ g }: { g: TranscriptGroup }) {
  // Headline: "BRAF · NM_004333.6 / NP_004324.2"
  const parts: string[] = [];
  if (g.gene) parts.push(g.gene);
  const acc = [g.transcript, g.proteinAccession].filter(Boolean).join(" / ");
  if (acc) parts.push(acc);
  const headline = parts.join(" · ");

  return (
    <div className="group-header">
      <div className="group-title">
        {headline || "(transcript)"}
        {g.isManeSelect && (
          <span className="mane-badge mane-select" title="MANE Select - NCBI/Ensembl agreed-upon default transcript">
            MANE Select
          </span>
        )}
        {g.isManePlusClinical && (
          <span className="mane-badge mane-plus" title="MANE Plus Clinical - clinically important additional transcript">
            MANE Plus Clinical
          </span>
        )}
        {g.isCanonical && !g.isManeSelect && !g.isManePlusClinical && (
          <span className="mane-badge canonical" title="Ensembl canonical transcript">
            Canonical
          </span>
        )}
      </div>
      <div className="group-sub">
        {g.consequenceTerms && g.consequenceTerms.length > 0 && (
          <span className="consequence-pill">{g.consequenceTerms.join(", ")}</span>
        )}
        {g.hgvsc && <span className="hgvs-inline">{g.hgvsc}</span>}
        {g.hgvsp && <span className="hgvs-inline">{g.hgvsp}</span>}
      </div>
    </div>
  );
}

export function VariantPanel({ data }: Props) {
  const { groups, variants } = data;
  const hasTranscripts = groups.perTranscript.length > 0;

  return (
    <div className="panel">
      <h2>
        Mutation representations ({variants.length}
        {hasTranscripts ? ` across ${groups.perTranscript.length} transcript${groups.perTranscript.length === 1 ? "" : "s"}` : ""})
      </h2>

      {/* Universal (transcript-independent) */}
      {groups.universal.length > 0 && (
        <div className="group-block">
          <div className="group-header">
            <div className="group-title">Transcript-independent</div>
            <div className="group-sub">
              <span className="muted-small">dbSNP / genomic coordinates - same for every transcript</span>
            </div>
          </div>
          <ChipList items={groups.universal} />
        </div>
      )}

      {/* Per-transcript groups */}
      {groups.perTranscript.map((g, i) => (
        <div className="group-block" key={`${g.transcript ?? "tx"}-${i}`}>
          <GroupHeader g={g} />
          <ChipList items={g.variants} />
        </div>
      ))}

      {/* Fallback */}
      {groups.fallback.length > 0 && (
        <div className="group-block">
          <div className="group-header">
            <div className="group-title">Unresolved input</div>
            <div className="group-sub">
              <span className="muted-small">
                Could not canonicalize via VEP/Mutalyzer - searching on the raw input only.
              </span>
            </div>
          </div>
          <ChipList items={groups.fallback} />
        </div>
      )}

      {data.canonical.notes.length > 0 && (
        <div className="notes">
          {data.canonical.notes.map((n, i) => (
            <div key={i}>• {n}</div>
          ))}
        </div>
      )}
    </div>
  );
}
