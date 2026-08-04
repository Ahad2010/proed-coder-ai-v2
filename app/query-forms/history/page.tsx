"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Item = {
  id: string;
  scenario: string;
  draft: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  SENT: "bg-brand-50 text-brand-700",
  APPROVED: "bg-brand-50 text-brand-700",
  ARCHIVED: "bg-line-soft text-ink-faint",
  DRAFT: "bg-amber-50 text-amber-700",
};

export default function QueryFormHistoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/query-form/list");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        setItems(j.items ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function shortDate(s: string): string {
    const d = new Date(s);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label-eyebrow">Track B · Saved queries</div>
            <h1 className="mt-2 text-2xl font-semibold text-ink">Query form history</h1>
            <p className="mt-1 text-sm text-ink-soft">
              All physician query drafts saved to the shared library.
            </p>
          </div>
          <Link href="/query-forms" className="btn-primary whitespace-nowrap">
            + New query
          </Link>
        </div>
      </section>

      {loading && <div className="text-sm text-ink-faint">Loading…</div>}

      {err && (
        <div className="rounded-md border border-brick-100 bg-brick-50 p-3 text-sm text-brick-700">
          {err}
        </div>
      )}

      {!loading && items.length === 0 && !err && (
        <div className="ledger-card p-8 text-center text-sm text-ink-soft">
          No saved queries yet.{" "}
          <Link href="/query-forms" className="font-medium text-brand-600 hover:underline">
            Draft your first query
          </Link>
          .
        </div>
      )}

      {/* Filing-log index — numbered rows read like a ledger, since order here is
          literally chronological filing order and worth surfacing. */}
      <div className="ledger-card divide-y divide-line-soft">
        {items.map((it, idx) => {
          const isOpen = expandedId === it.id;
          return (
            <article key={it.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 gap-3">
                  <span className="mt-0.5 font-mono text-xs text-ink-faint">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`chip ${STATUS_STYLE[it.status] ?? "bg-line-soft text-ink-soft"}`}
                      >
                        {it.status}
                      </span>
                      <span className="font-mono text-[11px] text-ink-faint">
                        {shortDate(it.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-ink">{it.scenario}</p>
                  </div>
                </div>
                <button
                  onClick={() => setExpandedId(isOpen ? null : it.id)}
                  className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline"
                >
                  {isOpen ? "Hide" : "View draft"}
                </button>
              </div>
              {isOpen && (
                <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-line-soft bg-paper p-3 text-xs leading-relaxed text-ink">
                  {it.draft}
                </pre>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
