# VCR (variant cancer risk)

Powered by the Huang Lab at Mount Sinai (<https://labs.icahn.mssm.edu/kuanhuanglab/>).

GitHub: <https://github.com/Huang-lab/VCR>

VCR is a serverless web app that answers one question for a variant: how likely is a carrier to have the disease, compared with everyone else?
Paste a variant in any common notation (HGVSp, HGVSc, HGVSg, short forms like `V600E`, `BRAF p.V600E`, or a dbSNP rsID).
VCR resolves it, looks up its penetrance, sets that beside a published base rate for the disease, and lists the ClinVar records for the variant.

VCR was split from [VarCrawl](https://github.com/Huang-lab/VarCrawl).
VarCrawl stays the literature search tool (PubMed, Europe PMC and ClinVar by mutation).
VCR keeps the variant resolution and ClinVar search, and adds the penetrance view.

## Stack

- **Next.js 14 (app router)**: deploys to Vercel as static UI plus route handlers.
- **Ensembl VEP REST** (`rest.ensembl.org`, `grch37.rest.ensembl.org`) for HGVSp, HGVSc and HGVSg cross-conversion across transcripts.
- **Mutalyzer** (`mutalyzer.nl/api`) as an HGVS normalizer (best effort).
- **NCBI Variation Services** as a RefSeq-aware fallback (best effort).
- **NCBI Entrez E-utilities** (`eutils.ncbi.nlm.nih.gov`) for ClinVar search.
- **Upstash Redis** (optional) for caching and per-client rate limiting.

GRCh38 and GRCh37 are both supported through the two Ensembl REST endpoints.

## Getting started

```bash
npm install
cp .env.example .env.local
# add NCBI_API_KEY + NCBI_EMAIL for 10 req/s ClinVar throughput
npm run dev
```

Open <http://localhost:3000>.

## Penetrance card

One search box takes an rsID, HGVS, or gene + change.
The result page shows a summary (penetrance and ClinVar), then the penetrance card, then the ClinVar records and every form of the variant.
Penetrance is matched by rsID, or by GRCh38 position.

dbSNP gives one rsID to every substitution at a position, so an rsID alone does not identify a variant.
`BRCA2 p.E1308K` (G>A) and `BRCA2 p.E1308*` (G>T) share rs80358638, and only the stop-gain is in eTable 4.
A search for one exact single-base change therefore matches only that allele.
When the dataset has a different change at the same position, the page says so rather than showing it as if it were the variant searched.
A search by rsID still matches every allele under that rsID, and indels are matched more loosely because they can be written several ways.
For GRCh37 searches the GRCh38 position comes from the server's lookup on the other build.

If Ensembl cannot resolve the variant (it did not answer in time, or did not recognise the input), the page says "Unavailable" with a "Search again" button, rather than reporting "No data" for a lookup that never happened.
Nonsense variants can be written with `*`, `Ter` or `X` (`BRCA2 p.E97*`, `p.Glu97Ter`, `p.E97X`).

Penetrance here is the share of carriers with an ICD-10 diagnosis of the disease.
The clinical algorithm (ML phenotype) column of eTable 4 is not used.
The card is written for non-specialist clinicians: a plain-language summary sentence, 100-person icon arrays, and a "How to read this" glossary.
Each estimate has a 95% Wilson confidence range, shown as a "likely range", and variants with fewer than 30 carriers are flagged.

### Base rates

Where a published general-population rate is on file (`lib/penetrance/baseline.ts`), the card sets the carriers' rate beside it.
It says whether the carriers' rate is above, below, or not clearly different from the published rate.
"Above" or "below" is only claimed when the base rate falls outside the carriers' 95% range.

Read these comparisons with care:

- The base rates are approximate figures from the literature, not the rate among non-carriers in the source cohort.
- The comparison is not adjusted for age, sex, or ancestry, and the two groups were sampled differently.
- A "below" result does not show a variant is protective.
- Base rates are lifetime or overall figures, so they are compared only at the lifetime (oldest age) view.
- The values were entered by hand and should be checked against the cited sources before any clinical use.

### Screening thresholds

Where guidelines set a lifetime-risk level for extra screening or another action, the card draws it as a reference line and says whether the carriers' 95% range sits above or below it (`lib/penetrance/thresholds.ts`).

- **Breast cancer**: 20% lifetime risk, the level at which ACS (2007), ACR and NCCN advise adding a yearly breast MRI to mammography.
- **Prostate cancer**: guidelines tie screening to specific genes, family history and ancestry rather than to a risk level.
  The card shows NCCN's gene-based advice (PSA screening from age 40 for BRCA2 carriers) as text and draws no line.

As with base rates, "above" or "below" is only claimed when the level falls outside the carriers' 95% range.
The comparison is made only at the lifetime (oldest age) view.
These levels are meant for one person's estimated lifetime risk, usually from family-history models, so the card calls the comparison a rough guide.
The values were entered by hand and should be checked against the current guidelines before any clinical use.

### Examples

The search box offers four cancer examples, in two groups by how far carriers sit above the general-population rate in eTable 4.
"Much higher risk" is 4 times the base rate or more, and "Moderately higher risk" is 2 to 4 times.
Each example is one where the card says "Above the published general-population rate".
Most variants in eTable 4 have few carriers (these examples have 2 to 12), so the card flags small counts.
The examples live in `lib/penetrance/examples.ts`, and `tests/examples.test.ts` checks each one against the bundled CSV.
Stop-gains that two different substitutions can produce (`BRCA2 p.L809*`, `p.Y1655*` and `p.Y3098*`) are left out, because Ensembl VEP timed out on them repeatedly when the list was chosen.

### Data

Data is bundled in `public/data/etable4_penetrance.csv`, from eTable 4 of the JAMA article at <https://jamanetwork.com/journals/jama/fullarticle/2788347> (lifetime penetrance, all ages).
You can upload your own CSV with the same columns (only the ICD-10 count column is needed).
Add an `Age` column to provide age-specific data.
Rows sharing a variant then form a cumulative penetrance curve, and the card shows an age slider and chart.
The "Demo: age-specific" dataset is synthetic and illustrative only.

## API

### `POST /api/search`

```json
{ "query": "BRAF p.V600E", "assembly": "GRCh38" }
```

Expands the variant and searches ClinVar in a single request.
It returns the expansion (`classified`, `canonical`, `groups`, `variants`), the phrases actually searched (`searchTerms`), and the `clinvar` result set.
This is what the UI calls.
Send `Accept: application/x-ndjson` to stream: the expansion arrives first, then ClinVar, then a `done` event.

### `POST /api/expand`

```json
{ "query": "BRAF p.V600E", "assembly": "GRCh38" }
```

Returns the classified input, canonical variant, and an array of every string representation to search on.

### `POST /api/clinvar`

```json
{ "variants": ["V600E", "p.Val600Glu", "c.1799T>A", "chr7:g.140753336A>T"], "gene": "BRAF" }
```

Runs one phrase query per variant against NCBI `db=clinvar`.
It returns ClinVar records with germline classification, review status, and conditions.
Records are sorted by clinical significance (Pathogenic, Likely Pathogenic, VUS, and so on).
Passing `gene` and `proteinForms` filters out off-target records.

## How it works

1. **Input classification (`lib/hgvs/classify.ts`)**
  - Detects whether a query looks like protein, cDNA or genomic HGVS, a short form (for example `V600E`), a gene + variant form, or a dbSNP rsID.

2. **Canonicalization and cross-conversion (`lib/hgvs/convert.ts`)**
  - Resolves a canonical variant using Ensembl VEP (plus fallbacks).
  - Converts across HGVSp, HGVSc and HGVSg, and across GRCh38 and GRCh37 when possible.
  - VEP writes alleles on the strand of the input, so for reverse-strand genes (CHEK2, BRCA1, TP53 and others) the alleles are flipped to the forward strand before the genomic HGVS is built.

3. **Variant enumeration (`lib/hgvs/enumerate.ts`)**
  - Expands one canonical event into many searchable strings: bare and prefixed HGVS, gene-prefixed forms, one-letter and three-letter protein forms, transcript-specific forms, and rsID and genomic coordinate forms.
  - Groups by transcript so MANE Select and MANE Plus Clinical forms are explicit.

4. **ClinVar retrieval and filtering (`lib/clinvar/entrez.ts`, `lib/clinvar/filter.ts`)**
  - Runs one exact-phrase Entrez `esearch` per representation and unions the record IDs.
  - Applies gene and protein-form filtering to reduce off-target records.
  - Sorts by clinical significance priority.

5. **Penetrance lookup (`lib/penetrance/`)**
  - Parses the bundled or uploaded CSV, matches records by rsID or locus, and computes confidence ranges and the base-rate comparison.

6. **Upstream pacing (`lib/entrez/scheduler.ts`)**
  - Every outbound Entrez call passes through a token-bucket limiter with a concurrency ceiling, shared process-wide.
  - Tokens accrue at the published rate while several requests stay in flight, so round-trip latency overlaps instead of accumulating across the representations a search expands into.
  - A retry waits for its own token before going out, so a burst of retries during an upstream wobble cannot push the rate over the limit.
  - An upstream `Retry-After` is honoured up to a ceiling, because NCBI can ask for longer than the whole function budget.
  - The limiter is per server instance and NCBI's quota is per API key, so a multi-instance deployment can still exceed the rate in aggregate.
    The defaults leave headroom and `Retry-After` on a 429 remains the backstop.

7. **Resilience controls (`lib/ratelimit.ts`, `lib/cache.ts`)**
  - Per-client rate limiting and response caching (both optional, through Upstash Redis).
  - Per-request timeouts on Entrez and Ensembl calls, so one hung upstream call cannot consume the whole serverless function budget.
  - The ClinVar deadline is counted from the start of the request, so a slow variant lookup shortens the ClinVar window instead of pushing the request past the function limit.
  - Source diagnostics mark likely partial or rate-limited upstream retrievals.
  - A partial or rate-limited result is cached for a minute rather than six hours, so the retry its status message advises actually reaches NCBI again.

## Sharing and export

- Searches are deep-linkable: `/?q=BRAF%20p.V600E&assembly=GRCh38` reruns the search on load, and browser back and forward moves between searches.
- Results export to CSV (ClinVar records and the full list of searched representations).
- Fields are quoted per RFC 4180, and values beginning `=`, `+`, `-` or `@` are prefixed so a spreadsheet reads them as text rather than formulas.

## Testing

```bash
npm test
```

Vitest covers the input classifier, the variant enumerator, search-term construction, ClinVar querying and filtering, penetrance parsing, statistics and base rates, screening thresholds, the cancer example set (checked against the bundled CSV), exact-allele matching, the Ensembl timeout and retry, VEP strand handling, CSV export, the cache wrapper, the rate limiter, and a throughput test that asserts both the latency budget and rate compliance against a simulated upstream.

`lib/hgvs/convert.ts` still depends on live Ensembl VEP and is exercised manually.

## Deployment (Vercel)

1. Import the repo on Vercel.
2. Set env vars: `NCBI_API_KEY`, `NCBI_EMAIL` (and optionally Upstash vars).
3. Deploy. No other config is needed.
