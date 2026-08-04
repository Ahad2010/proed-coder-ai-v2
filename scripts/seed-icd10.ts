/**
 * Phase 2 — ICD-10-CM 2026 Seed Pipeline
 *
 *   1. Auto-download the official CMS/CDC order file (or use local if present)
 *   2. Parse fixed-width lines → { code, isBillable, description }
 *   3. Batch upsert into MedicalCode table
 *   4. Embed descriptions with the current embedding provider
 *   5. Write vectors into the pgvector `embedding` column
 *
 * Run:
 *   npm run seed:icd10
 *
 * Speed:
 *   Parsing + inserting: 5–10 minutes over the network
 *   Xenova embedding:    ~1–2 hours on CPU (one-time)
 *   OpenAI embedding:    ~5–10 minutes total, ~$0.50
 *
 *   To use OpenAI temporarily for a faster embed:
 *     1. Set EMBEDDING_PROVIDER=openai + OPENAI_API_KEY in .env
 *     2. Run this script
 *     3. Set EMBEDDING_PROVIDER back to xenova
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { db } from "../lib/db";
import { embed, embedBatch, toPgVector, CURRENT_PROVIDER } from "../lib/embeddings";

const DATA_DIR = "./data";
const TARGET_FILE = path.join(DATA_DIR, "icd10cm-order-2026.txt");

// Official CDC mirror of the CMS ICD-10-CM release
const CDC_URL =
  "https://ftp.cdc.gov/pub/health_statistics/nchs/publications/ICD10CM/2026/icd10cm-Code%20Descriptions-2026.zip";
const CMS_URL =
  "https://www.cms.gov/files/zip/2026-code-descriptions-tabular-order.zip";

const INSERT_BATCH = 500;
const EMBED_PROGRESS_EVERY = 50;

// ---------- parsing ----------

type Parsed = {
  code: string;
  isBillable: boolean;
  shortDesc: string;
  longDesc: string;
};

/**
 * Parse a line from icd10cm-order-YYYY.txt.
 * Fixed-width format (from CMS spec):
 *   [0..4]   order number (5 chars)
 *   [6..13]  code (up to 7-8 chars, right-space-padded)
 *   [14]     valid/billable flag ("0" or "1")
 *   [16..76] short description (60 chars)
 *   [77..]   long description
 */
function parseLine(line: string): Parsed | null {
  if (line.length < 20) return null;
  const code = line.substring(6, 14).trim();
  const flag = line.substring(14, 16).trim();
  const shortDesc = line.substring(16, 77).trim();
  const longDesc = line.substring(77).trim();
  if (!code || !longDesc) return null;
  return { code, isBillable: flag === "1", shortDesc, longDesc };
}

// ---------- download ----------

async function downloadZip(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  // Dynamic import so adm-zip only loads when actually needed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AdmZip: any = (await import("adm-zip")).default;
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
}

function findOrderFile(dir: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const nested = findOrderFile(full);
      if (nested) return nested;
    } else if (/icd10cm-order-\d{4}\.txt$/i.test(e.name)) {
      return full;
    }
  }
  return null;
}

async function ensureDataFile(): Promise<string> {
  if (fs.existsSync(TARGET_FILE)) {
    console.log(`✓ Using cached data file: ${TARGET_FILE}\n`);
    return TARGET_FILE;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const zipPath = path.join(DATA_DIR, "icd10cm-2026.zip");

  for (const url of [CDC_URL, CMS_URL]) {
    try {
      console.log(`📥 Downloading from ${new URL(url).hostname}...`);
      await downloadZip(url, zipPath);
      console.log("✓ Downloaded, extracting...");
      await extractZip(zipPath, DATA_DIR);
      fs.unlinkSync(zipPath);

      const found = findOrderFile(DATA_DIR);
      if (!found) throw new Error("order file not found in archive");
      if (found !== TARGET_FILE) fs.renameSync(found, TARGET_FILE);
      console.log(`✓ Extracted: ${TARGET_FILE}\n`);
      return TARGET_FILE;
    } catch (err) {
      console.warn(`   Failed: ${(err as Error).message}`);
    }
  }

  console.error("\n❌ Auto-download failed. Manual instructions:");
  console.error("  1. Open https://www.cms.gov/medicare/coding-billing/icd-10-codes");
  console.error("  2. Download the '2026 Code Descriptions in Tabular Order (ZIP)'");
  console.error(`  3. Extract 'icd10cm-order-2026.txt' into ${DATA_DIR}/`);
  console.error("  4. Re-run: npm run seed:icd10\n");
  process.exit(1);
}

// ---------- steps ----------

/**
 * Retry a DB call with exponential backoff on transient network errors.
 * Handles Neon compute suspension, dropped connections, and pool timeouts.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX = 6;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const transient =
        e.code === "P1001" || // can't reach DB
        e.code === "P1017" || // server closed connection
        e.code === "P2024" || // pool timeout
        e.message?.includes("Connection") ||
        e.message?.includes("ECONNRESET") ||
        e.message?.includes("timeout");
      if (!transient || attempt === MAX - 1) throw err;
      const wait = Math.min(2000 * Math.pow(2, attempt), 60000);
      console.log(
        `\n   ⚠️  DB error (${e.code ?? "network"}), retrying in ${wait / 1000}s... (attempt ${attempt + 1}/${MAX})`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

async function parseAll(file: string): Promise<Parsed[]> {
  const codes: Parsed[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const p = parseLine(line);
    if (p) codes.push(p);
  }
  return codes;
}

async function insertBatched(codes: Parsed[]) {
  // createMany + skipDuplicates: one SQL per batch instead of 500 round-trips.
  // Re-runs are safe because ICD codes are unique.
  for (let i = 0; i < codes.length; i += INSERT_BATCH) {
    const batch = codes.slice(i, i + INSERT_BATCH);
    await withRetry(() =>
      db.medicalCode.createMany({
        data: batch.map((c) => ({
          code: c.code,
          codeSystem: "ICD10CM" as const,
          description: c.longDesc,
          isBillable: c.isBillable,
          sourceName: "CMS.gov",
          sourceUrl: "https://www.cms.gov/medicare/coding-billing/icd-10-codes",
        })),
        skipDuplicates: true,
      })
    );
    const done = Math.min(i + INSERT_BATCH, codes.length);
    if (i % (INSERT_BATCH * 10) === 0 || done >= codes.length) {
      console.log(`   ${done}/${codes.length}`);
    }
  }
}

async function embedMissing(limit?: number) {
  const EMBED_BATCH = 32; // Xenova sweet spot on CPU
  const limitClause = limit ? `LIMIT ${limit}` : "";

  // When limited, prioritise billable codes since those are what coders search
  const billableClause = limit ? `AND "isBillable" = true` : "";

  const rows: Array<{ id: string; description: string }> = await db.$queryRawUnsafe(
    `SELECT id, description
       FROM "MedicalCode"
      WHERE "codeSystem" = 'ICD10CM'
        AND embedding IS NULL
        ${billableClause}
      ORDER BY code
      ${limitClause}`
  );
  console.log(`   ${rows.length} codes need embedding${limit ? ` (limited to ${limit} billable)` : ""}\n`);

  let done = 0;
  const started = Date.now();

  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const texts = batch.map((r) => r.description);

    // Batched inference — one Xenova call per 32 texts instead of 32 calls
    const vecs = await embedBatch(texts);

    // Concurrent DB writes for this batch, wrapped in retry.
    // If Neon drops the connection mid-batch, the whole batch retries idempotently.
    await withRetry(() =>
      Promise.all(
        batch.map((row, j) =>
          db.$executeRawUnsafe(
            `UPDATE "MedicalCode" SET embedding = $1::vector WHERE id = $2`,
            toPgVector(vecs[j]),
            row.id
          )
        )
      )
    );

    done += batch.length;

    // Log every 10 batches (~320 codes) — enough signal without spam
    if (i % (EMBED_BATCH * 10) === 0 || done >= rows.length) {
      const elapsed = (Date.now() - started) / 1000;
      const rate = done / elapsed;
      const eta = ((rows.length - done) / rate) / 60;
      console.log(
        `   ${done}/${rows.length}  ${rate.toFixed(1)}/s  ETA ${eta.toFixed(1)}m`
      );
    }
  }
}

// ---------- main ----------

async function main() {
  console.log("=== ProEd Coder AI — ICD-10-CM 2026 Seed ===");
  console.log(`Embedding provider: ${CURRENT_PROVIDER}`);

  // CLI: --limit=N restricts embedding to first N billable codes
  const limitArg = process.argv.slice(2).find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
  if (limit) console.log(`Embed limit: first ${limit} billable codes`);
  console.log("");

  const file = await ensureDataFile();

  console.log("📖 Parsing order file...");
  const codes = await parseAll(file);
  const billable = codes.filter((c) => c.isBillable).length;
  console.log(`   ✓ Parsed ${codes.length} codes  (${billable} billable, ${codes.length - billable} headers)\n`);

  console.log("💾 Upserting into database...");
  await insertBatched(codes);
  console.log("   ✓ Insert complete\n");

  console.log("🧠 Embedding descriptions...");
  await embedMissing(limit);
  console.log("   ✓ Embedding complete\n");

  const total = await db.medicalCode.count({ where: { codeSystem: "ICD10CM" } });
  const embedded: Array<{ n: bigint }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS n FROM "MedicalCode" WHERE embedding IS NOT NULL`
  );
  console.log(`✅ Seed complete — ${total} codes total, ${embedded[0].n} embedded.\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
