import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { classifyIntent, type Intent } from "@/lib/llm";
import { embed, toPgVector } from "@/lib/embeddings";

// Transformers.js needs the Node runtime (not Edge) — it uses ONNX Runtime
// and native modules that don't work in the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ query: z.string().min(2).max(500) });

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

async function searchByText(query: string): Promise<unknown[]> {
  const likeQuery = `%${query}%`;
  return db.$queryRawUnsafe<unknown[]>(
    `SELECT id, code, "codeSystem", description, "isBillable",
            "hccCategory", "hccWeight", "hedisMeasure",
            "codingNotes", "sourceName", "sourceUrl",
            NULL::float AS similarity
     FROM "MedicalCode"
     WHERE description ILIKE $1 OR code ILIKE $1 OR "sourceName" ILIKE $1
     ORDER BY "isBillable" DESC, code
     LIMIT 10;`,
    likeQuery
  );
}

export async function GET() {
  return jsonError("Use POST /api/search with a JSON body: { query: string }", 405);
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (error) {
    return jsonError("Invalid request body. Send JSON with a non-empty query.", 400);
  }

  const { query } = parsed;

  let intent: Intent = "codes";
  try {
    intent = await classifyIntent(query);
  } catch (error) {
    console.error("Intent classification failed, defaulting to codes:", error);
  }

  let results: unknown[] = [];

  if (intent === "codes") {
    try {
      const vec = await embed(query);
      const pg = toPgVector(vec);
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
    } catch (error) {
      console.error("Embedding search failed, falling back to text search:", error);
      results = await searchByText(query);
    }
  }

  db.auditLog
    .create({ data: { action: "search", payload: { query, intent, resultCount: results.length } } })
    .catch(() => {});

  return NextResponse.json({
    intent,
    results,
    latencyMs: Date.now() - t0,
  });
}
