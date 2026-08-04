import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { chat } from "@/lib/llm";
import {
  QUERY_FORM_SYSTEM_PROMPT,
  buildQueryFormUserPrompt,
} from "@/lib/query-form-prompts";
import { retrievePolicyChunks } from "@/lib/policy-retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";   // 👈 yeh line add karein


const Body = z.object({
  scenario: z.string().min(10).max(4000),
  chartSnippet: z.string().max(4000).optional(),
  mrn: z.string().max(50).optional(),
  dos: z.string().max(50).optional(),
  physicianName: z.string().max(100).optional(),
  coderName: z.string().max(100).optional(),
});

type Citation = {
  n: number;
  chunkId: string;
  source: string;
  docTitle: string;
  sourceUrl: string;
  excerpt: string;
};

type LlmResponse = {
  draft: string;
  compliance_notes: string[];
  clinical_indicators_used: string[];
  questions_asked: string[];
  citations_used?: number[];
};

function safeParseLlmJson(raw: string): LlmResponse | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const firstBrace = s.indexOf("{");
  if (firstBrace > 0) s = s.slice(firstBrace);
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace >= 0 && lastBrace < s.length - 1) s = s.slice(0, lastBrace + 1);
  try {
    const obj = JSON.parse(s);
    if (typeof obj.draft !== "string") return null;
    return {
      draft: obj.draft,
      compliance_notes: Array.isArray(obj.compliance_notes)
        ? obj.compliance_notes.filter((x: unknown) => typeof x === "string")
        : [],
      clinical_indicators_used: Array.isArray(obj.clinical_indicators_used)
        ? obj.clinical_indicators_used.filter((x: unknown) => typeof x === "string")
        : [],
      questions_asked: Array.isArray(obj.questions_asked)
        ? obj.questions_asked.filter((x: unknown) => typeof x === "string")
        : [],
      citations_used: Array.isArray(obj.citations_used)
        ? obj.citations_used.filter((x: unknown) => typeof x === "number")
        : [],
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const input = parsed.data;

  // Phase 4.2 — Retrieve policy chunks for grounding
  let policyChunks: Awaited<ReturnType<typeof retrievePolicyChunks>> = [];
  try {
    policyChunks = await retrievePolicyChunks(input.scenario, 4);
  } catch (e) {
    console.warn("Policy retrieval failed (proceeding without grounding):", e);
  }

  const referenceMaterials = policyChunks.map((c) => ({
    title: c.docTitle,
    source: c.sourceName,
    excerpt: c.content.slice(0, 400),
  }));

  const userPrompt = buildQueryFormUserPrompt({ ...input, referenceMaterials });

  let raw: string;
  try {
    raw = await chat({
      system: QUERY_FORM_SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 2000,
      temperature: 0.2,
    });
  } catch (e) {
    console.error("LLM call failed:", e);
    return NextResponse.json(
      { error: "LLM generation failed. Check GROQ_API_KEY." },
      { status: 500 }
    );
  }

  const parsedResponse = safeParseLlmJson(raw);

  // Build the full citation set with source metadata
  const citations: Citation[] = policyChunks.map((c, i) => ({
    n: i + 1,
    chunkId: c.chunkId,
    source: c.sourceName,
    docTitle: c.docTitle,
    sourceUrl: c.sourceUrl,
    excerpt: c.content.slice(0, 300),
  }));

  if (!parsedResponse) {
    return NextResponse.json({
      draft: raw,
      compliance_notes: [
        "⚠️  LLM did not return structured JSON — showing raw output.",
      ],
      clinical_indicators_used: [],
      questions_asked: [],
      citations,
      citationsUsed: [],
      latencyMs: Date.now() - t0,
      structured: false,
    });
  }

  db.auditLog
    .create({
      data: {
        action: "query_form_generate",
        payload: {
          scenarioPreview: input.scenario.slice(0, 200),
          indicatorsCount: parsedResponse.clinical_indicators_used.length,
          questionsCount: parsedResponse.questions_asked.length,
          citationsCount: citations.length,
        },
      },
    })
    .catch(() => {});

  return NextResponse.json({
    ...parsedResponse,
    citations,
    citationsUsed: parsedResponse.citations_used ?? [],
    latencyMs: Date.now() - t0,
    structured: true,
  });
}
