/**
 * Phase 4.2 — Policy Corpus Seed
 *
 * Ingests policy TXT files from data/policies/ into PolicyDocument + PolicyChunk.
 * Each file becomes a PolicyDocument, chunked into ~800-char passages
 * (roughly ~200 tokens each), then embedded with Xenova.
 *
 * Chunks are retrieved at query-form generation time for grounded citations.
 *
 * To swap in real CMS/NCQA PDFs later:
 *   1. Save PDFs into data/policies/
 *   2. Add `import PDFParser from "pdf-parse"` and read PDF text
 *   3. Otherwise pipeline is identical
 *
 * Run:
 *   npm run seed:policies
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { embed, toPgVector, CURRENT_PROVIDER } from "../lib/embeddings";
import { withRetry, wakeDB } from "./_utils";

const POLICIES_DIR = "./data/policies";
const CHUNK_SIZE_CHARS = 800;
const CHUNK_OVERLAP = 100;

// Source metadata from filename prefix
const SOURCE_MAP: Record<string, { source: string; docType: string; url: string }> = {
  "ahima": {
    source: "AHIMA/ACDIS",
    docType: "guideline",
    url: "https://www.ahima.org/resource/guidelines-for-achieving-a-compliant-query-practice-2019-update/",
  },
  "cms-hcc": {
    source: "CMS",
    docType: "policy",
    url: "https://www.cms.gov/medicare/payment/medicare-advantage-rates-statistics/risk-adjustment",
  },
  "ncqa-hedis": {
    source: "NCQA",
    docType: "measure_spec",
    url: "https://www.ncqa.org/hedis/",
  },
  "medicare-advantage-radv": {
    source: "CMS",
    docType: "policy",
    url: "https://www.cms.gov/medicare-advantage/risk-adjustment-data-validation",
  },
};

function detectSource(filename: string): { source: string; docType: string; url: string } {
  for (const prefix of Object.keys(SOURCE_MAP)) {
    if (filename.toLowerCase().startsWith(prefix)) return SOURCE_MAP[prefix];
  }
  return { source: "Unknown", docType: "policy", url: "" };
}

function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (cleaned.length <= CHUNK_SIZE_CHARS) return [cleaned];

  const chunks: string[] = [];
  // Prefer breaking at paragraph boundaries; fall back to sentence, then hard cut
  let i = 0;
  while (i < cleaned.length) {
    const remaining = cleaned.length - i;
    if (remaining <= CHUNK_SIZE_CHARS) {
      chunks.push(cleaned.slice(i).trim());
      break;
    }
    let end = i + CHUNK_SIZE_CHARS;
    // Search backward for a paragraph break
    const paraBreak = cleaned.lastIndexOf("\n\n", end);
    if (paraBreak > i + CHUNK_SIZE_CHARS / 2) end = paraBreak + 2;
    else {
      // Fall back to sentence-ending punctuation
      const sentBreak = Math.max(
        cleaned.lastIndexOf(". ", end),
        cleaned.lastIndexOf("? ", end),
        cleaned.lastIndexOf("! ", end)
      );
      if (sentBreak > i + CHUNK_SIZE_CHARS / 2) end = sentBreak + 2;
    }
    chunks.push(cleaned.slice(i, end).trim());
    i = end - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.length > 50);
}

async function ingestFile(filename: string) {
  const filepath = path.join(POLICIES_DIR, filename);
  const raw = fs.readFileSync(filepath, "utf8");
  const meta = detectSource(filename);
  const title = filename
    .replace(/\.(txt|pdf|md)$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  console.log(`\n📄 ${filename}`);
  console.log(`   Source: ${meta.source}  ·  Type: ${meta.docType}`);
  console.log(`   Length: ${raw.length} chars`);

  // Remove any prior version of this document so re-runs are idempotent
  await withRetry(() =>
    db.policyDocument.deleteMany({ where: { title, sourceName: meta.source } })
  );

  const doc = await withRetry(() =>
    db.policyDocument.create({
      data: {
        title,
        sourceName: meta.source,
        sourceUrl: meta.url,
        docType: meta.docType,
        content: raw,
      },
    })
  );

  // Embed the whole doc summary (first 800 chars) for coarse doc-level search
  const docEmbedding = await embed(raw.slice(0, 800));
  await withRetry(() =>
    db.$executeRawUnsafe(
      `UPDATE "PolicyDocument" SET embedding = $1::vector WHERE id = $2`,
      toPgVector(docEmbedding),
      doc.id
    )
  );

  // Chunk + embed
  const chunks = chunkText(raw);
  console.log(`   Chunks: ${chunks.length}`);

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const vec = await embed(chunk);
    // Create + set embedding
    await withRetry(async () => {
      const created = await db.policyChunk.create({
        data: { policyDocId: doc.id, chunkIndex: idx, content: chunk },
      });
      await db.$executeRawUnsafe(
        `UPDATE "PolicyChunk" SET embedding = $1::vector WHERE id = $2`,
        toPgVector(vec),
        created.id
      );
    });
  }
  console.log(`   ✓ ${chunks.length} chunks embedded`);
}

async function main() {
  console.log("=== ProEd Coder AI — Policy Corpus Seed ===");
  console.log(`Embedding provider: ${CURRENT_PROVIDER}\n`);

  if (!fs.existsSync(POLICIES_DIR)) {
    console.error(`❌ Missing ${POLICIES_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(POLICIES_DIR)
    .filter((f) => /\.txt$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.error("❌ No .txt policy files found in data/policies/");
    process.exit(1);
  }

  await wakeDB();

  console.log(`Found ${files.length} policy files.`);
  for (const f of files) await ingestFile(f);

  const [{ n: docCount }]: Array<{ n: bigint }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS n FROM "PolicyDocument"`
  );
  const [{ n: chunkCount }]: Array<{ n: bigint }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS n FROM "PolicyChunk" WHERE embedding IS NOT NULL`
  );

  console.log(`\n✅ Seed complete — ${docCount} documents, ${chunkCount} embedded chunks.\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
