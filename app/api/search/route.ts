import { NextRequest, NextResponse } from "next/server";
import { classify } from "@/lib/hgvs/classify";
import { canonicalizeMultiAssembly } from "@/lib/hgvs/convert";
import { enumerateGrouped, flattenVariants } from "@/lib/hgvs/enumerate";
import { Assembly } from "@/lib/hgvs/types";
import { cacheGet, cacheSet, hash } from "@/lib/cache";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  ExpansionResult,
  MAX_SEARCH_TERMS,
  buildProteinForms,
  buildPubmedSearchTerms,
  collectVariants,
  literatureSearchBlockedReason,
  normalizeTerms,
  resolveGene,
} from "@/lib/search/terms";
import {
  entrezConfigFromEnv,
  runClinvarSearch,
  runPubmedSearch,
  skippedPubmedPayload,
} from "@/lib/search/run";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One request that expands a mutation and searches every source.
 *
 * The UI previously made three sequential round-trips (expand, then ClinVar,
 * then PubMed) because two concurrent NCBI searches from the browser could
 * each assume the full Entrez quota. Running them inside one request means
 * they share the process-wide rate limiter, so they can go in parallel without
 * exceeding NCBI's limit — and the client waits for one round-trip, not three.
 *
 * `/api/expand`, `/api/pubmed` and `/api/clinvar` remain available for
 * programmatic use.
 */

interface Body {
  query: string;
  assembly?: Assembly;
}

const VALID_ASSEMBLIES: Assembly[] = ["GRCh38", "GRCh37"];

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req);
  if (rl && !rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.query || typeof body.query !== "string") {
    return NextResponse.json({ error: "Missing 'query'" }, { status: 400 });
  }
  const assembly = body.assembly ?? "GRCh38";
  if (!VALID_ASSEMBLIES.includes(assembly)) {
    return NextResponse.json({ error: "Invalid 'assembly'" }, { status: 400 });
  }

  const query = body.query.trim();
  const classified = classify(query);
  if (classified.kind === "unknown") {
    return NextResponse.json(
      {
        error:
          "Could not recognize the mutation format. Examples: BRAF p.V600E, NM_004333.6:c.1799T>A, chr7:g.140753336A>T, rs113488022.",
        classified,
      },
      { status: 400 },
    );
  }

  const cacheKey = `search:${hash({ q: query, a: assembly })}`;
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const canonical = await canonicalizeMultiAssembly(classified, assembly);
  const groups = enumerateGrouped(canonical);
  const expand: ExpansionResult = {
    input: query,
    assembly,
    classified,
    canonical,
    groups,
    variants: flattenVariants(groups),
  };

  const gene = resolveGene(expand);
  const proteinForms = buildProteinForms(expand);
  const clinvarTerms = normalizeTerms(collectVariants(expand), MAX_SEARCH_TERMS);
  const pubmedTerms = normalizeTerms(buildPubmedSearchTerms(expand), MAX_SEARCH_TERMS);
  const blocked = literatureSearchBlockedReason(expand);

  const cfg = entrezConfigFromEnv();

  // Both searches share this process's Entrez limiter, so the aggregate rate
  // stays within quota while their latencies overlap.
  const [pubmed, clinvar] = await Promise.all([
    blocked
      ? Promise.resolve(skippedPubmedPayload(blocked))
      : runPubmedSearch(pubmedTerms, cfg),
    runClinvarSearch(clinvarTerms, cfg, { gene, proteinForms }),
  ]);

  const resp = {
    input: query,
    assembly,
    classified,
    canonical,
    groups,
    variants: expand.variants,
    searchTerms: { pubmed: pubmedTerms, clinvar: clinvarTerms },
    pubmed,
    clinvar,
  };

  // Short TTL: new publications and ClinVar re-classifications land often
  // enough that a day-old answer could mislead.
  await cacheSet(cacheKey, resp, 3600 * 6);
  return NextResponse.json(resp);
}
