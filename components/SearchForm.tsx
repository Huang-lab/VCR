"use client";

import type { Assembly } from "@/lib/hgvs/types";
import { EXAMPLE_GROUPS } from "@/lib/penetrance/examples";

interface Props {
  /**
   * Controlled inputs. The page owns these and keeps them in step with the
   * URL, so a shared link, a typed query and a back/forward navigation all
   * agree on what is being searched. Mirroring the URL into local state here
   * let the two drift: navigating back to a search on a different genome build
   * left the dropdown showing the build from the previous search, labelling the
   * displayed coordinates with the wrong assembly.
   */
  query: string;
  assembly: Assembly;
  onQueryChange: (query: string) => void;
  onAssemblyChange: (assembly: Assembly) => void;
  onSearch: (query: string, assembly: Assembly) => void;
  disabled: boolean;
}

export function SearchForm({
  query,
  assembly,
  onQueryChange,
  onAssemblyChange,
  onSearch,
  disabled,
}: Props) {
  return (
    <>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) onSearch(query.trim(), assembly);
        }}
      >
        <input
          type="text"
          placeholder="rsID, HGVS, or gene + change (e.g. rs80359550, BRAF p.V600E)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          aria-label="Variant"
          autoFocus
          disabled={disabled}
        />
        <select
          value={assembly}
          onChange={(e) => onAssemblyChange(e.target.value as Assembly)}
          disabled={disabled}
          aria-label="Genome assembly"
        >
          <option value="GRCh38">GRCh38 / hg38</option>
          <option value="GRCh37">GRCh37 / hg19</option>
        </select>
        <button type="submit" disabled={disabled || !query.trim()} aria-busy={disabled}>
          {disabled ? (
            <>
              <span className="btn-spinner" aria-hidden="true" /> Searching
            </>
          ) : (
            "Search"
          )}
        </button>
      </form>
      <div className="examples" role="group" aria-label="Cancer examples">
        <span className="example-lead">Try a cancer example, grouped by risk compared with the general population:</span>
        {EXAMPLE_GROUPS.map((group) => (
          <div className="example-group" key={group.tier}>
            <span className="example-label">{group.label}</span>
            <span className="example-chips">
              {group.examples.map((ex) => (
                <button
                  key={ex.query}
                  type="button"
                  className="example-chip"
                  disabled={disabled}
                  onClick={() => {
                    onQueryChange(ex.query);
                    onSearch(ex.query, assembly);
                  }}
                >
                  {ex.query}
                  <span className="example-cancer">{ex.cancer}</span>
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
