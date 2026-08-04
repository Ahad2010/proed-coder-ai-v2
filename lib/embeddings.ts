/**
 * Provider-agnostic embeddings.
 *
 * Switch providers with EMBEDDING_PROVIDER env var:
 *   EMBEDDING_PROVIDER="xenova"  → free, runs locally via @huggingface/transformers
 *   EMBEDDING_PROVIDER="openai"  → paid, use in production once scale demands it
 *
 * Both providers output 384-dim vectors:
 *   - Xenova bge-small-en-v1.5 → 384 native
 *   - OpenAI text-embedding-3-small → 384 via `dimensions` param
 *
 * This means no DB schema changes when swapping providers — only a re-embed
 * batch job, since the two vector spaces are semantically different.
 */

import OpenAI from "openai";

const provider = (process.env.EMBEDDING_PROVIDER ?? "xenova").toLowerCase();

const XENOVA_MODEL =
  process.env.XENOVA_EMBEDDING_MODEL ?? "Xenova/bge-small-en-v1.5";
const OPENAI_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

/** Fixed dimension for both providers so the pgvector column never changes. */
export const EMBEDDING_DIMENSIONS = 384;

// Lazy-loaded Xenova pipeline (heavy — ~130MB model download on first call).
// Cached across requests via module scope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let xenovaPipe: any = null;

async function getXenovaPipe() {
  if (xenovaPipe) return xenovaPipe;
  // Dynamic import so this heavy dep isn't loaded when using OpenAI provider.
  const { pipeline } = await import("@huggingface/transformers");
  xenovaPipe = await pipeline("feature-extraction", XENOVA_MODEL, {
    dtype: "fp32",
  });
  return xenovaPipe;
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
 * Batch-embed multiple texts. Both providers batch natively:
 *  - Xenova accepts an array and returns a stacked tensor (batch_size × dims)
 *  - OpenAI accepts an array in one API call
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
  provider === "openai" ? OPENAI_MODEL : XENOVA_MODEL;
