"use client";

import { useState } from "react";
import Link from "next/link";

type Citation = {
  n: number;
  chunkId: string;
  source: string;
  docTitle: string;
  sourceUrl: string;
  excerpt: string;
};

type GenerateResponse = {
  draft: string;
  compliance_notes: string[];
  clinical_indicators_used: string[];
  questions_asked: string[];
  citations: Citation[];
  citationsUsed: number[];
  latencyMs: number;
  structured: boolean;
};

export default function QueryFormsPage() {
  const [scenario, setScenario] = useState("");
  const [chartSnippet, setChartSnippet] = useState("");
  const [mrn, setMrn] = useState("");
  const [dos, setDos] = useState("");
  const [physicianName, setPhysicianName] = useState("");
  const [coderName, setCoderName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GenerateResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editableDraft, setEditableDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!scenario.trim()) return;
    setLoading(true);
    setErr(null);
    setData(null);
    setSavedId(null);
    setCopied(false);

    try {
      const r = await fetch("/api/query-form/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario,
          chartSnippet: chartSnippet || undefined,
          mrn: mrn || undefined,
          dos: dos || undefined,
          physicianName: physicianName || undefined,
          coderName: coderName || undefined,
        }),
      });
      if (!r.ok) {
        const eb = await r.json().catch(() => ({}));
        throw new Error(eb.error ?? `HTTP ${r.status}`);
      }
      const json: GenerateResponse = await r.json();
      setData(json);
      setEditableDraft(json.draft);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function onCopy() {
    await navigator.clipboard.writeText(editableDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function onSave() {
    if (!data || !editableDraft) return;
    setSaving(true);
    try {
      const r = await fetch("/api/query-form/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedId ?? undefined,
          scenario,
          draft: editableDraft,
          citations: data.citations,
          status: "DRAFT",
        }),
      });
      const j = await r.json();
      if (r.ok && j.id) setSavedId(j.id);
      else throw new Error(j.error ?? "Save failed");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onExportDocx() {
    if (!editableDraft) return;
    setExporting(true);
    try {
      const r = await fetch("/api/query-form/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: editableDraft, format: "docx" }),
      });
      if (!r.ok) {
        const eb = await r.json().catch(() => ({}));
        throw new Error(eb.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `physician-query-${Date.now()}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const sampleScenarios = [
    "Chart notes 'diabetes' for patient seen 3/15/2024. Labs show HbA1c 8.2%, glucose 240 mg/dL. Patient is on metformin. Missing: type, control status, complications.",
    "Discharge summary states 'heart failure' as final diagnosis. BNP 850, EF 35% on echo. Patient on Lasix and Entresto. Missing: acute vs chronic, systolic vs diastolic.",
    "Progress note mentions 'CKD' — creatinine 2.1, eGFR 42. No stage documented. Patient has hypertension and Type 2 DM.",
  ];

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label-eyebrow">Track B · Query form drafting</div>
            <h1 className="mt-2 text-2xl font-semibold text-ink">
              Draft a compliant physician query.
            </h1>
            <p className="mt-1 max-w-xl text-sm text-ink-soft">
              Describe the documentation gap. The draft is grounded in real AHIMA/ACDIS
              policy text, with citations attached.
            </p>
          </div>
          <Link
            href="/query-forms/history"
            className="label-eyebrow whitespace-nowrap text-ink-faint hover:text-brand-600"
          >
            View history →
          </Link>
        </div>
      </section>

      <form onSubmit={onGenerate} className="space-y-4">
        <div>
          <label htmlFor="scenario" className="mb-1.5 block text-sm font-medium text-ink">
            Documentation gap
          </label>
          <textarea
            id="scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            rows={5}
            placeholder="e.g. Chart notes 'diabetes' for patient seen 3/15/2024. Labs show HbA1c 8.2%..."
            className="field-input"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="label-eyebrow">Try</span>
            {sampleScenarios.map((s, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setScenario(s)}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Example {i + 1}
              </button>
            ))}
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="label-eyebrow text-ink-faint hover:text-ink"
          >
            {showAdvanced ? "− Hide" : "+ Show"} optional fields (MRN, DOS, physician, coder)
          </button>
        </div>

        {showAdvanced && (
          <div className="ledger-card grid gap-3 p-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">MRN</label>
              <input
                value={mrn}
                onChange={(e) => setMrn(e.target.value)}
                placeholder="[MRN]"
                className="field-input py-2 font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Date of Service</label>
              <input
                value={dos}
                onChange={(e) => setDos(e.target.value)}
                placeholder="MM/DD/YYYY"
                className="field-input py-2 font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Physician name</label>
              <input
                value={physicianName}
                onChange={(e) => setPhysicianName(e.target.value)}
                placeholder="Dr. Smith"
                className="field-input py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Coder name (yours)</label>
              <input
                value={coderName}
                onChange={(e) => setCoderName(e.target.value)}
                placeholder="Jane Doe, CCS"
                className="field-input py-2"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-ink-soft">
                Chart snippet (optional — paste relevant record excerpt)
              </label>
              <textarea
                value={chartSnippet}
                onChange={(e) => setChartSnippet(e.target.value)}
                rows={3}
                className="field-input font-mono text-xs"
              />
            </div>
          </div>
        )}

        <button type="submit" disabled={loading || !scenario.trim()} className="btn-primary">
          {loading ? "Drafting query…" : "Draft query"}
        </button>
      </form>

      {err && (
        <div className="rounded-md border border-brick-100 bg-brick-50 p-3 text-sm text-brick-700">
          {err}
        </div>
      )}

      {data && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex items-center gap-3 font-mono text-[11px] text-ink-faint">
              <span>Generated in {data.latencyMs}ms</span>
              <span>·</span>
              <span>{data.citations.length} policy chunks retrieved</span>
              {!data.structured && (
                <span className="chip bg-amber-50 text-amber-700">Fallback formatting</span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onCopy} className="btn-secondary">
                {copied ? "✓ Copied" : "Copy"}
              </button>
              <button onClick={onSave} disabled={saving} className="btn-secondary">
                {saving ? "Saving…" : savedId ? "✓ Update" : "Save"}
              </button>
              <button
                onClick={onExportDocx}
                disabled={exporting}
                className="inline-flex items-center rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-paper-panel hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting ? "Exporting…" : "⬇ DOCX"}
              </button>
            </div>
          </div>

          {savedId && (
            <div className="rounded-md border border-brand-100 bg-brand-50 p-2 text-xs text-brand-700">
              ✓ Saved · <Link href="/query-forms/history" className="underline">View in history</Link>
            </div>
          )}

          {/* Letterhead-framed draft — evokes the formal physician query letter itself */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Draft query (editable)
            </label>
            <div className="ledger-card border-t-4 border-t-brand-600 p-1">
              <textarea
                value={editableDraft}
                onChange={(e) => setEditableDraft(e.target.value)}
                rows={20}
                className="w-full rounded-md bg-paper-panel px-4 py-3 font-mono text-xs leading-relaxed text-ink focus:outline-none"
              />
            </div>
          </div>

          {data.clinical_indicators_used.length > 0 && (
            <div className="ledger-card p-4">
              <div className="label-eyebrow">Clinical indicators used</div>
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {data.clinical_indicators_used.map((i, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-ink-faint">—</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.questions_asked.length > 0 && (
            <div className="ledger-card p-4">
              <div className="label-eyebrow">Questions asked</div>
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {data.questions_asked.map((q, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-ink-faint">—</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.compliance_notes.length > 0 && (
            <div className="ledger-card border-l-4 border-l-brand-600 p-4">
              <div className="label-eyebrow text-brand-700">Compliance notes (AHIMA/ACDIS)</div>
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {data.compliance_notes.map((n, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-brand-600">—</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.citations.length > 0 && (
            <div className="ledger-card border-l-4 border-l-amber-600 p-4">
              <div className="label-eyebrow text-amber-700">Policy references grounding this draft</div>
              <ul className="mt-3 space-y-4 text-sm text-ink">
                {data.citations.map((c) => (
                  <li key={c.n}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip bg-amber-50 font-bold text-amber-700">[{c.n}]</span>
                      <span className="font-medium">
                        {c.source} · {c.docTitle}
                      </span>
                      {data.citationsUsed.includes(c.n) && (
                        <span className="chip bg-brand-50 text-brand-700">cited</span>
                      )}
                    </div>
                    <div className="mt-1 pl-8 text-xs italic text-ink-soft">
                      &ldquo;{c.excerpt}&rdquo;
                    </div>
                    {c.sourceUrl && (
                      <a
                        href={c.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-8 mt-1 inline-block text-xs font-medium text-amber-700 hover:underline"
                      >
                        Open source →
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
