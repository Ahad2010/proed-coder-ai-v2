import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { classifyIntent } from "@/lib/llm";
import { embed, toPgVector } from "@/lib/embeddings";

// Transformers.js needs the Node runtime (not Edge) — it uses ONNX Runtime
// and native modules that don't work in the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ query: z.string().min(2).max(500) });

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { query } = parsed.data;

  // 1. Classify intent (codes / query_form / policy)
  const intent = await classifyIntent(query);

  // 2. Track A — codes lookup via pgvector cosine search
  let results: unknown[] = [];
  if (intent === "codes") {
    const vec = await embed(query);
    const pg = toPgVector(vec);
    // pgvector cosine distance operator `<=>` — lower is closer
    results = await db.$queryRawUnsafe(
      `SELECT id, code, "codeSystem", description, "isBillable",
              "hccCategory", "hccWeight", "hedisMeasure",
              "codingNotes", "sourceName", "sourceUrl",
              1 - (embedding <=> $1::vector) AS similarity
       FROM "MedicalCode"
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 10;`,
      pg
    );
  }
  // TODO Phase 4: intent === "query_form" and "policy" branches

  // 3. Audit log (best-effort, don't block)
  db.auditLog
    .create({ data: { action: "search", payload: { query, intent, resultCount: (results as unknown[]).length } } })
    .catch(() => {});

  return NextResponse.json({
    intent,
    results,
    latencyMs: Date.now() - t0,
  });
}
