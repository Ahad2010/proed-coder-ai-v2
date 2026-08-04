/**
 * Phase 3.2 — HCPCS Level II Seed
 *
 * Adds ~7,000 supply/drug/DME codes to MedicalCode with codeSystem = "HCPCS".
 * These are the alphanumeric codes coders use for wheelchairs, oxygen,
 * insulin injections, ambulance rides, prosthetics — anything Medicare
 * pays for that isn't a physician procedure (CPT) or a diagnosis (ICD-10).
 *
 * ---
 *
 * Data source (public, free):
 *   https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update
 *
 * Download the latest "Alpha-Numeric HCPCS File (ZIP)" — currently the
 * July 2026 release. Extract the ZIP and place the .xlsx file inside as:
 *   data/hcpcs-2026.xlsx
 *
 * The script auto-detects the header row and finds the HCPC + description
 * columns, so exact sheet layouts across quarters shouldn't matter.
 *
 * ---
 *
 * Run:
 *   npm run seed:hcpcs
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { embedBatch, toPgVector, CURRENT_PROVIDER } from "../lib/embeddings";
import { withRetry, wakeDB } from "./_utils";

const DATA_DIR = "./data";
const INSERT_BATCH = 500;
const EMBED_BATCH = 32;
const EMBED_CONCURRENT_WRITES = 5; // matches Prisma default pool

type Row = {
  code: string;
  shortDesc?: string;
  longDesc: string;
  isBillable: boolean;
  effectiveFrom?: Date;
  effectiveTo?: Date;
};

// ---------- source resolution ----------

function findHcpcsFile(): string {
  // Accept common filename patterns for the HCPCS Alpha-Numeric file
  const candidates = fs
    .readdirSync(DATA_DIR)
    .filter((f) =>
      /^hcpcs.*\.xlsx$/i.test(f) ||       // hcpcs-2026.xlsx
      /^hcpc\d{4}.*\.xlsx$/i.test(f) ||   // HCPC2026_A_ANWEB.xlsx
      /^\d{4}.*hcpcs.*\.xlsx$/i.test(f)   // 2026-alpha-numeric-hcpcs.xlsx
    );
  if (candidates.length === 0) {
    console.error("❌ No HCPCS file found in data/ directory.\n");
    console.error("Download the current file from:");
    console.error(
      "  https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update"
    );
    console.error("\nGrab the latest 'Alpha-Numeric HCPCS File (ZIP)'.");
    console.error("Extract the .xlsx from inside and save it as:");
    console.error(`  ${DATA_DIR}/hcpcs-2026.xlsx\n`);
    process.exit(1);
  }
  const chosen = path.join(DATA_DIR, candidates[0]);
  console.log(`   ✓ Found HCPCS file: ${chosen}`);
  return chosen;
}

// ---------- header auto-detection ----------

type Layout = {
  headerRow: number;
  codeIdx: number;
  longDescIdx: number;
  shortDescIdx: number;
  actionCodeIdx: number;
  termDateIdx: number;
  effDateIdx: number;
};

function normalizeHeader(v: unknown): string {
  return String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function detectLayout(rows: unknown[][]): Layout | null {
  const MAX_SCAN = Math.min(15, rows.length);

  for (let r = 0; r < MAX_SCAN; r++) {
    const cols = rows[r].map(normalizeHeader);

    // Code column: "HCPC", "HCPCS Code", or generic "Code"
    const codeIdx = cols.findIndex(
      (c) => c === "hcpc" || c === "hcpcs" || c === "hcpcs code" || c === "code"
    );
    if (codeIdx < 0) continue;

    // Long description: "LONG DESCRIPTION" or "Long Description"
    const longDescIdx = cols.findIndex(
      (c) => /^long\s*desc/.test(c) || c === "long description"
    );
    if (longDescIdx < 0) continue;

    const shortDescIdx = cols.findIndex(
      (c) => /^short\s*desc/.test(c) || c === "short description"
    );
    const actionCodeIdx = cols.findIndex(
      (c) => c === "action code" || c === "action" || c === "act code"
    );
    const termDateIdx = cols.findIndex(
      (c) => /^term/.test(c) || c === "termination date"
    );
    const effDateIdx = cols.findIndex(
      (c) => /^added.*eff|^effective|^add.*eff/.test(c)
    );

    return {
      headerRow: r,
      codeIdx,
      longDescIdx,
      shortDescIdx,
      actionCodeIdx,
      termDateIdx,
      effDateIdx,
    };
  }
  return null;
}

// ---------- parsing ----------

function parseExcelDate(v: unknown): Date | undefined {
  if (v == null || v === "") return undefined;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) {
    // YYYYMMDD
    return new Date(
      parseInt(s.slice(0, 4), 10),
      parseInt(s.slice(4, 6), 10) - 1,
      parseInt(s.slice(6, 8), 10)
    );
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

async function parseXlsx(filepath: string): Promise<Row[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("xlsx").catch(() => null);
  if (!mod) throw new Error("The xlsx package is required. Run: npm install xlsx");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = mod.default ?? mod;
  if (typeof XLSX.readFile !== "function") {
    throw new Error("xlsx package loaded but readFile function missing");
  }

  const wb = XLSX.readFile(filepath);
  let best: Row[] = [];
  let bestSheet = "";

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    const layout = detectLayout(rows);
    if (!layout) continue;

    const out: Row[] = [];
    for (let i = layout.headerRow + 1; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells || cells.length === 0) continue;

      const code = String(cells[layout.codeIdx] ?? "").trim().toUpperCase();
      const longDesc = String(cells[layout.longDescIdx] ?? "").trim();
      if (!code || !longDesc) continue;
      if (!/^[A-Z]\d{4}$/.test(code)) continue; // HCPCS = 1 letter + 4 digits

      const shortDesc =
        layout.shortDescIdx >= 0
          ? String(cells[layout.shortDescIdx] ?? "").trim() || undefined
          : undefined;

      const effectiveFrom =
        layout.effDateIdx >= 0 ? parseExcelDate(cells[layout.effDateIdx]) : undefined;
      const effectiveTo =
        layout.termDateIdx >= 0 ? parseExcelDate(cells[layout.termDateIdx]) : undefined;

      // A code is billable if it isn't terminated (no term date, or term date > today)
      const now = new Date();
      const isBillable = !effectiveTo || effectiveTo > now;

      out.push({ code, longDesc, shortDesc, isBillable, effectiveFrom, effectiveTo });
    }

    if (out.length > best.length) {
      best = out;
      bestSheet = sheetName;
    }
  }

  if (best.length === 0) {
    throw new Error(
      `No HCPCS data found. Sheets tried: ${wb.SheetNames.join(", ")}`
    );
  }
  console.log(`   ✓ Parsed sheet "${bestSheet}" — ${best.length} codes`);
  return best;
}

// ---------- insert ----------

async function insertAll(codes: Row[]) {
  const active = codes.filter((c) => c.isBillable).length;
  console.log(`   Active: ${active}  Terminated: ${codes.length - active}`);

  for (let i = 0; i < codes.length; i += INSERT_BATCH) {
    const batch = codes.slice(i, i + INSERT_BATCH);
    await withRetry(() =>
      db.medicalCode.createMany({
        data: batch.map((c) => ({
          code: c.code,
          codeSystem: "HCPCS" as const,
          description: c.longDesc,
          isBillable: c.isBillable,
          effectiveFrom: c.effectiveFrom,
          effectiveTo: c.effectiveTo,
          sourceName: "CMS.gov",
          sourceUrl:
            "https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update",
        })),
        skipDuplicates: true,
      })
    );
    const done = Math.min(i + INSERT_BATCH, codes.length);
    if (i % (INSERT_BATCH * 4) === 0 || done >= codes.length) {
      console.log(`   ${done}/${codes.length}`);
    }
  }
}

// ---------- embed ----------

async function embedMissing() {
  const rows: Array<{ id: string; description: string }> = await db.$queryRawUnsafe(
    `SELECT id, description
       FROM "MedicalCode"
      WHERE "codeSystem" = 'HCPCS'
        AND embedding IS NULL`
  );
  console.log(`   ${rows.length} HCPCS codes need embedding\n`);

  if (rows.length === 0) return;

  let done = 0;
  const started = Date.now();

  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const texts = batch.map((r) => r.description);
    const vecs = await embedBatch(texts);

    // Write vectors in sub-chunks that fit Prisma's default pool
    for (let j = 0; j < batch.length; j += EMBED_CONCURRENT_WRITES) {
      const chunk = batch.slice(j, j + EMBED_CONCURRENT_WRITES);
      const chunkVecs = vecs.slice(j, j + EMBED_CONCURRENT_WRITES);
      await withRetry(() =>
        Promise.all(
          chunk.map((row, k) =>
            db.$executeRawUnsafe(
              `UPDATE "MedicalCode" SET embedding = $1::vector WHERE id = $2`,
              toPgVector(chunkVecs[k]),
              row.id
            )
          )
        )
      );
    }

    done += batch.length;
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
  console.log("=== ProEd Coder AI — HCPCS Level II Seed ===");
  console.log(`Embedding provider: ${CURRENT_PROVIDER}\n`);

  console.log("📖 Locating HCPCS file...");
  const file = findHcpcsFile();

  console.log("\n📖 Parsing HCPCS file...");
  const codes = await parseXlsx(file);

  await wakeDB();

  console.log("\n💾 Upserting into database...");
  await insertAll(codes);
  console.log("   ✓ Insert complete\n");

  console.log("🧠 Embedding descriptions...");
  await embedMissing();
  console.log("   ✓ Embedding complete\n");

  const total = await db.medicalCode.count({ where: { codeSystem: "HCPCS" } });
  const embedded: Array<{ n: bigint }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS n FROM "MedicalCode" WHERE "codeSystem" = 'HCPCS' AND embedding IS NOT NULL`
  );
  console.log(`✅ Seed complete — ${total} HCPCS codes total, ${embedded[0].n} embedded.\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
