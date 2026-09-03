"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SearchForm } from "@/components/SearchForm";
import { VariantPanel } from "@/components/VariantPanel";
import { ResultsList } from "@/components/ResultsList";
import { ClinvarResults } from "@/components/ClinvarResults";
import { ExportBar } from "@/components/ExportBar";
import type { Assembly } from "@/lib/hgvs/types";

interface VariantString { text: string; label: string }

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

interface SourceStatus {
  complete: boolean;
  likelyRateLimited: boolean;
  likelyPartial: boolean;
  message?: string;
}

interface ExpandPart {
  input: string;
  assembly: Assembly;
  classified: {
    kind: string;
    gene?: string;
    accession?: string;
    body: string;
    proteinShort?: string;
    proteinLong?: string;
  };
  canonical: {
    gene?: string;
    rsid?: string;
    hgvsg?: string;
    notes: string[];
    consequences: {
      gene?: string;
      hgvsc?: string;
      hgvsp?: string;
      proteinShort?: string;
      proteinLong?: string;
    }[];
  };
  groups: {
    universal: VariantString[];
    perTranscript: TranscriptGroup[];
    fallback: VariantString[];
  };
  variants: VariantString[];
}

interface PubmedPart {
  count: number;
  status?: SourceStatus;
  articles: {
    pmid: string;
    title: string;
    authors: string[];
    journal: string;
    pubDate: string;
    doi?: string;
    matchedBy: string[];
    sources?: string[];
  }[];
}

interface ClinvarPart {
  count: number;
  unfilteredCount?: number;
  gene?: string;
  proteinForms?: string[];
  status?: SourceStatus;
  records: {
    uid: string;
    accession?: string;
    title?: string;
    gene?: string;
    clinicalSignificance?: string;
    reviewStatus?: string;
    lastEvaluated?: string;
    conditions: string[];
    matchedBy: string[];
  }[];
}

/** Response of POST /api/search — expansion plus both searches in one payload. */
interface SearchResponse extends ExpandPart {
  searchTerms?: { pubmed: string[]; clinvar: string[] };
  pubmed: PubmedPart;
  clinvar: ClinvarPart;
  error?: string;
}

const VALID_ASSEMBLIES: Assembly[] = ["GRCh38", "GRCh37"];

function parseAssembly(raw: string | null): Assembly {
  return raw && (VALID_ASSEMBLIES as string[]).includes(raw) ? (raw as Assembly) : "GRCh38";
}

/** Link that reruns this exact search, for sharing with collaborators. */
function shareUrlFor(query: string, assembly: Assembly): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = new URLSearchParams({ q: query, assembly }).toString();
  url.hash = "";
  return url.toString();
}

export default function Page() {
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<{ query: string; assembly: Assembly }>({
    query: "",
    assembly: "GRCh38",
  });

  // Cancels the previous search when a new one starts, so a slow earlier
  // response can never overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);

  const runSearch = useCallback(
    async (query: string, assembly: Assembly, { updateUrl = true } = {}) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setError(null);
      setResult(null);
      setLoading(true);

      if (updateUrl && typeof window !== "undefined") {
        const params = new URLSearchParams({ q: query, assembly });
        window.history.pushState({ q: query, assembly }, "", `?${params.toString()}`);
      }

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, assembly }),
          signal: controller.signal,
        });
        const data = (await res.json()) as SearchResponse;

        if (controller.signal.aborted) return;

        if (!res.ok) {
          if (res.status === 429) {
            const retry = res.headers.get("Retry-After");
            setError(
              retry
                ? `Too many requests — try again in ${retry}s.`
                : "Too many requests — please slow down and try again shortly.",
            );
          } else {
            setError(data.error ?? "Search failed.");
          }
          return;
        }

        setResult(data);
      } catch (e) {
        // An aborted request is a superseded search, not a failure.
        if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [],
  );

  // Run the search named by the URL, on first load and on back/forward.
  useEffect(() => {
    const fromLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q")?.trim() ?? "";
      const assembly = parseAssembly(params.get("assembly"));
      setInitial({ query: q, assembly });
      if (q) void runSearch(q, assembly, { updateUrl: false });
      else setResult(null);
    };

    fromLocation();
    window.addEventListener("popstate", fromLocation);
    return () => {
      window.removeEventListener("popstate", fromLocation);
      inFlight.current?.abort();
    };
  }, [runSearch]);

  const pubmed = result?.pubmed;
  const clinvar = result?.clinvar;

  return (
    <main>
      <h1>VarCrawl</h1>
      <p className="subtitle">
        Paste a mutation in any HGVS-like notation. We expand it into every way and search PubMed, Europe PMC, and ClinVar for you.
      </p>
      <p className="subtitle" style={{ marginTop: -16 }}>
        Powered by the Huang Lab at Mount Sinai (
        <a href="https://labs.icahn.mssm.edu/kuanhuanglab/" target="_blank" rel="noopener noreferrer">
          labs.icahn.mssm.edu/kuanhuanglab
        </a>
        ) · GitHub (
        <a href="https://github.com/Huang-lab/VarCrawl" target="_blank" rel="noopener noreferrer">
          github.com/Huang-lab/VarCrawl
        </a>
        )
      </p>

      <div className="panel how-it-works" aria-label="How VarCrawl works">
        <h2>How it works</h2>
        <ol>
          <li>Classify your query, canonicalize it, and generate transcript-aware variant representations.</li>
          <li>Run exact-phrase searches per representation in PubMed/Europe PMC and ClinVar, merge PMIDs/ClinVar IDs, and track matched forms.</li>
          <li>Rank PubMed by best match (with recency tie-breaker) and flag likely incomplete upstream results.</li>
        </ol>
      </div>

      <SearchForm
        onSearch={(q, a) => void runSearch(q, a)}
        disabled={loading}
        initialQuery={initial.query}
        initialAssembly={initial.assembly}
      />

      {error && <div className="error">{error}</div>}

      {loading && (
        <p className="spinner">Expanding representations and searching PubMed, Europe PMC, and ClinVar…</p>
      )}

      {result && (
        <>
          <ExportBar
            query={result.input}
            shareUrl={shareUrlFor(result.input, result.assembly)}
            articles={pubmed?.articles ?? []}
            records={clinvar?.records ?? []}
            groups={result.groups}
          />
          <VariantPanel data={result} />
          {clinvar && <ClinvarResults data={clinvar} />}
          {pubmed && <ResultsList data={pubmed} />}
        </>
      )}
    </main>
  );
}
