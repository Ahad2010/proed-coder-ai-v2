"use client";

import { useState } from "react";

type CodeCard = {
  code: string;
  codeSystem: "ICD10CM" | "HCPCS" | "CPT";
  description: string;
  isBillable: boolean;
  hccCategory?: string | null;
  hccWeight?: number | null;
  hedisMeasure?: string | null;
  codingNotes?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
};

type SearchResponse = {
  intent: "codes" | "query_form" | "policy";
  results: CodeCard[];
  latencyMs: number;
};

// RAF weights in practice cluster well under 3.0 — used as the meter's fixed scale
// so bar width stays meaningfully comparable across different codes.
const RAF_SCALE_MAX = 3.0;

const SYSTEM_EDGE: Record<CodeCard["codeSystem"], string> = {
  ICD10CM: "border-l-brand-600",
  HCPCS: "border-l-amber-600",
  CPT: "border-l-ink-soft",
};

function RafMeter({ weight }: { weight: number }) {
  const pct = Math.min(100, Math.max(4, (weight / RAF_SCALE_MAX) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-amber-50">
        <div
          className="h-full rounded-full bg-amber-600"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[11px] text-amber-700">
        RAF {weight.toFixed(3)}
      </span>
    </div>
  );
}

export default function Page() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      const body = await r.json().catch(() => null);
      if (!r.ok) {
        const message = body?.error || `HTTP ${r.status}`;
        throw new Error(message);
      }

      setData(body as SearchResponse);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="label-eyebrow">Requisition · Code lookup</div>
        <h1 className="mt-2 max-w-2xl text-2xl font-semibold leading-snug text-ink">
          Ask anything about medical codes, HEDIS, HCC, or policy forms.
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Sources: CMS.gov · NCQA · HHS · Medicaid · ICD10Data · AAPC · AMA · eClinicalWorks
        </p>

        <form onSubmit={onSearch} className="mt-6">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. Type 2 diabetes with neuropathy"
              className="field-input flex-1 font-mono"
            />
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </form>
      </section>

      {err && (
        <div className="rounded-md border border-brick-100 bg-brick-50 p-3 text-sm text-brick-700">
          {err}
        </div>
      )}

      {data && (
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <span className="label-eyebrow">Result set</span>
            <span className="chip bg-line-soft text-ink-soft">{data.intent}</span>
            <span className="font-mono text-[11px] text-ink-faint">{data.latencyMs}ms</span>
          </div>

          {data.results.length === 0 && (
            <div className="ledger-card p-6 text-center text-sm text-ink-faint">
              No results yet — Phase 2 will seed ICD-10 data.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {data.results.map((c) => (
              <article
                key={c.code}
                className={`ledger-card border-l-4 p-4 ${SYSTEM_EDGE[c.codeSystem]}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-lg font-semibold text-ink">{c.code}</div>
                    <div className="label-eyebrow mt-0.5">{c.codeSystem}</div>
                  </div>
                  <span
                    className={`chip ${
                      c.isBillable
                        ? "bg-brand-50 text-brand-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {c.isBillable ? "Billable" : "Header"}
                  </span>
                </div>

                <p className="mt-3 text-sm text-ink-soft">{c.description}</p>

                {c.hccCategory && (
                  <div className="mt-3 rounded-md border border-line-soft bg-paper px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-ink">
                        {c.hccCategory.split("·")[0].trim()}
                      </span>
                      {c.hccWeight != null && <RafMeter weight={c.hccWeight} />}
                    </div>
                  </div>
                )}

                {c.hedisMeasure && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-brand-700">
                    <span className="chip bg-brand-50 text-brand-700">HEDIS</span>
                    <span>Impacts {c.hedisMeasure}</span>
                  </div>
                )}

                {c.sourceName && (
                  <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-2 text-xs text-ink-faint">
                    <span>{c.sourceName}</span>
                    {c.sourceUrl && (
                      <a
                        href={c.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-brand-600 hover:underline"
                      >
                        Open source →
                      </a>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
