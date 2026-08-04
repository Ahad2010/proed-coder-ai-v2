/**
 * Provider-agnostic embeddings.
 *
 * Switch providers with EMBEDDING_PROVIDER env var:
 *   EMBEDDING_PROVIDER="xenova"  → free, runs locally via @huggingface/transformers
 *                                  (NOTE: requires native onnxruntime binary —
 *                                  does NOT work on Vercel serverless functions)
 *   EMBEDDING_PROVIDER="hf-api"  → free, same model, calls HF's remote Inference
 *                                  API instead of running it locally — works on
 *                                  Vercel. Requires HF_TOKEN env var.
 *   EMBEDDING_PROVIDER="openai"  → paid, use in production once scale demands it
 *
 * All providers output 384-dim vectors:
 *   - Xenova / hf-api bge-small-en-v1.5 → 384 native (same vector space)
 *   - OpenAI text-embedding-3-small → 384 via `dimensions` param (different space)
 *
 * This means no DB schema changes when swapping providers — only a re-embed
 * batch job if switching to/from OpenAI, since that vector space differs.
 */

import OpenAI from "openai";

const provider = (process.env.EMBEDDING_PROVIDER ?? "xenova").toLowerCase();

const XENOVA_MODEL =
  process.env.XENOVA_EMBEDDING_MODEL ?? "Xenova/bge-small-en-v1.5";
const OPENAI_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const HF_API_MODEL =
  process.env.XENOVA_EMBEDDING_MODEL ?? "BAAI/bge-small-en-v1.5";

/** Fixed dimension for both providers so the pgvector column never changes. */
export const EMBEDDING_DIMENSIONS = 384;

// Lazy-loaded Xenova pipeline (heavy — ~130MB model download on first call).
// Cached across requests via module scope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let xenovaPipe: any = null;

async function getXenovaPipe() {
  if (xenovaPipe) return xenovaPipe;
  // Dynamic import so this heavy dep isn't loaded when using other providers.
  const { pipeline, env } = await import("@huggingface/transformers");

  if (process.env.VERCEL) {
    env.cacheDir = "/tmp/.cache";
    env.allowLocalModels = false;
  }

  xenovaPipe = await pipeline("feature-extraction", XENOVA_MODEL, {
    dtype: "fp32",
  });
  return xenovaPipe;
}

/**
 * Calls Hugging Face's hosted Inference API for feature-extraction —
 * same model/vector-space as Xenova, but no local native binary needed.
 * Works fine on Vercel serverless functions.
 */
async function hfApiEmbed(texts: string[]): Promise<number[][]> {
  const token = process.env.HF_TOKEN;
  if (!token) {
    throw new Error("HF_TOKEN env var is required for EMBEDDING_PROVIDER=hf-api");
  }

  const res = await fetch(
    `https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_API_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HF Inference API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // API returns either [dim] (single input) or [batch, dim] shape.
  const rows: number[][] = Array.isArray(data[0]) ? data : [data];
  return rows;
}

const openai =
  provider === "openai"
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

/**
 * Embed a piece of text into a 384-dim vector.
 * Used for semantic search over codes and policy documents.
 */
export async function embed(text: string): Promise<number[]> {
  if (provider === "xenova") {
    const p = await getXenovaPipe();
    const out = await p(text, { pooling: "mean", normalize: true });
    return Array.from(out.data as Float32Array);
  }

  if (provider === "hf-api") {
    const rows = await hfApiEmbed([text]);
    return rows[0];
  }

  if (provider === "openai" && openai) {
    const res = await openai.embeddings.create({
      model: OPENAI_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return res.data[0].embedding;
  }

  throw new Error(
    `Embedding provider "${provider}" not configured. Set EMBEDDING_PROVIDER + corresponding API key.`
  );
}

/**
 * Batch-embed multiple texts. All providers batch natively.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (provider === "openai" && openai) {
    const res = await openai.embeddings.create({
      model: OPENAI_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return res.data.map((d) => d.embedding);
  }

  if (provider === "hf-api") {
    return hfApiEmbed(texts);
  }

  // Xenova — pass the array directly, then split the flat tensor into rows
  const p = await getXenovaPipe();
  const out = await p(texts, { pooling: "mean", normalize: true });
  const dim = EMBEDDING_DIMENSIONS;
  const flat = out.data as Float32Array;
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(Array.from(flat.slice(i * dim, (i + 1) * dim)));
  }
  return result;
}

/** Format a JS number[] as a Postgres pgvector literal, e.g. "[0.1,0.2,...]" */
export function toPgVector(v: number[]): string {
  return "[" + v.join(",") + "]";
}

export const CURRENT_PROVIDER = provider;
export const CURRENT_MODEL =
  provider === "openai" ? OPENAI_MODEL : provider === "hf-api" ? HF_API_MODEL : XENOVA_MODEL;