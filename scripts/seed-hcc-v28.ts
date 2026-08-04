/**
 * Phase 3.1 — CMS-HCC V28 Risk Adjustment Model Seed
 *
 * CMS publishes a "wide format" mapping file:
 *   Column A: ICD-10 code
 *   Columns B..N: one column per model (ESRD, CMS-HCC V22/V24/V28, RxHCC V05/V08)
 *   Cell value: the HCC number that code maps to, or blank
 *
 * We only care about the V28 column.
 *
 * Coefficients (RAF weights) are published SEPARATELY by CMS in the
 * "denominator" and "coefficients" documents. This script populates
 * hccCategory only; hccWeight stays null until you feed it a coefficient file.
 * For the demo, HCC category alone is 90% of the visible value.
 *
 * ---
 *
 * Data source:
 *   https://www.cms.gov/medicare/payment/medicare-advantage-rates-statistics/risk-adjustment/2026-model-software-icd-10-mappings
 *
 * Save the ICD-10 mappings sheet as ONE of:
 *   data/hcc-v28-crosswalk.csv
 *   data/hcc-v28-crosswalk.xlsx
 *
 * Run:
 *   npm run seed:hcc
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { withRetry, wakeDB, normalizeIcd10 } from "./_utils";

const DATA_DIR = "./data";
const CSV_PATH = path.join(DATA_DIR, "hcc-v28-crosswalk.csv");
const XLSX_PATH = path.join(DATA_DIR, "hcc-v28-crosswalk.xlsx");

const UPDATE_BATCH = 100;

type Mapping = {
  icd10: string;
  hcc: string;
  hccLabel?: string;
  coefficient?: number;
};

// ---------- source resolution ----------

function findDataFile(): string {
  if (fs.existsSync(CSV_PATH)) return CSV_PATH;
  if (fs.existsSync(XLSX_PATH)) return XLSX_PATH;
  console.error("❌ No HCC V28 crosswalk file found.\n");
  console.error("Download from:");
  console.error(
    "  https://www.cms.gov/medicare/payment/medicare-advantage-rates-statistics/risk-adjustment/2026-model-software-icd-10-mappings"
  );
  console.error(`Save as: ${XLSX_PATH}  (or .csv)`);
  process.exit(1);
}

// ---------- CSV splitter ----------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuote = !inQuote;
    } else if (c === "," && !inQuote) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// ---------- header auto-detection ----------

type Layout = {
  headerRow: number;
  icdIdx: number;
  hccIdx: number;
  labelIdx: number;
  coefIdx: number;
};

function detectLayout(rows: string[][]): Layout | null {
  const MAX_SCAN = Math.min(30, rows.length);

  for (let r = 0; r < MAX_SCAN; r++) {
    // CMS embeds \r\n INSIDE cells to visually stack column labels in Excel.
    // Flatten all embedded whitespace before matching so "CMS-HCC\r\nModel\r\nCategory\r\nV28"
    // becomes "cms-hcc model category v28".
    const cols = rows[r].map((c) =>
      (c ?? "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    );

    // Need at least a plausible ICD column
    const icdIdx = cols.findIndex(
      (c) =>
        /^icd[\s\-]?10/i.test(c) ||
        c === "diagcode" ||
        c === "diag code" ||
        c === "dx" ||
        c === "dx code" ||
        c === "diagnosis code" ||
        c === "code" ||
        c === "icd" ||
        c === "icd10cm" ||
        c === "icd-10-cm"
    );
    if (icdIdx < 0) continue;

    // Prefer V28-specific column. Fall back to any HCC column that isn't
    // ESRD or RxHCC.
    let hccIdx = cols.findIndex((c) => /v[\s\-]?28/i.test(c) && !/rx/i.test(c));
    if (hccIdx < 0) {
      hccIdx = cols.findIndex(
        (c) =>
          /hcc/i.test(c) && !/rxhcc|esrd|rx\s*hcc/i.test(c) && c !== ""
      );
    }
    if (hccIdx < 0) continue;

    const labelIdx = cols.findIndex((c) =>
      /description|label|category\s*name|hcc\s*label/i.test(c)
    );
    const coefIdx = cols.findIndex((c) =>
      /coef|weight|raf/i.test(c)
    );

    return { headerRow: r, icdIdx, hccIdx, labelIdx, coefIdx };
  }
  return null;
}

// ---------- parsing ----------

function parseRows(rows: string[][]): Mapping[] {
  const layout = detectLayout(rows);
  if (!layout) {
    console.error("❌ Could not find a usable header row. First 10 rows:\n");
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      console.error(`  Row ${i}: ${JSON.stringify(rows[i].slice(0, 8))}`);
    }
    console.error("\nExpected a row that contains BOTH:");
    console.error("  - a column named 'ICD-10' (or DiagCode/DX/Code)");
    console.error("  - a column named 'V28' (or 'HCC', not 'RxHCC' or 'ESRD')");
    throw new Error("Header row not detected");
  }

  const rawHdr = rows[layout.headerRow].map((c) => (c ?? "").trim());
  // Same flatten applied to what we print so debug lines stay readable
  const hdr = rawHdr.map((c) => c.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " "));
  console.log(`   ✓ Header row found at row ${layout.headerRow}`);
  console.log(`     ICD column     [${layout.icdIdx}]: "${hdr[layout.icdIdx]}"`);
  console.log(`     HCC column     [${layout.hccIdx}]: "${hdr[layout.hccIdx]}"`);
  if (layout.labelIdx >= 0)
    console.log(`     Label column   [${layout.labelIdx}]: "${hdr[layout.labelIdx]}"`);
  if (layout.coefIdx >= 0)
    console.log(`     Coef column    [${layout.coefIdx}]: "${hdr[layout.coefIdx]}"`);
  else console.log(`     Coefficients:  not in this file (will be null)`);
  console.log("");

  const out: Mapping[] = [];
  for (let i = layout.headerRow + 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols || cols.length === 0) continue;

    const icd = normalizeIcd10(cols[layout.icdIdx] ?? "");
    const hccRaw = (cols[layout.hccIdx] ?? "").trim();
    if (!icd || !hccRaw) continue;

    // HCC value must be numeric — strips out label rows, footnotes, blanks
    const hccMatch = hccRaw.match(/^(\d{1,3})/);
    if (!hccMatch) continue;
    const hcc = hccMatch[1];

    const label =
      layout.labelIdx >= 0 ? (cols[layout.labelIdx] ?? "").trim() : undefined;
    const coef =
      layout.coefIdx >= 0
        ? parseFloat((cols[layout.coefIdx] ?? "").trim())
        : NaN;

    out.push({
      icd10: icd,
      hcc,
      hccLabel: label || undefined,
      coefficient: isNaN(coef) ? undefined : coef,
    });
  }
  return out;
}

function parseCsv(content: string): Mapping[] {
  const raw = content.split(/\r?\n/);
  const rows = raw.map(splitCsvLine);
  return parseRows(rows);
}

async function parseXlsx(filepath: string): Promise<Mapping[]> {
  // xlsx is a CommonJS module. When imported via dynamic import under tsx,
  // its exports come back wrapped as { default: {...} }. Unwrap both cases.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("xlsx").catch(() => null);
  if (!mod) {
    throw new Error(
      "The xlsx package is required. Run: npm install xlsx"
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = mod.default ?? mod;
  if (typeof XLSX.readFile !== "function") {
    throw new Error(
      "xlsx package loaded but readFile function is missing. Try: npm install xlsx@latest"
    );
  }
  const wb = XLSX.readFile(filepath);

  // Try every sheet until one produces mappings
  let bestSheet = "";
  let best: Mapping[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    try {
      const parsed = parseRows(rows);
      if (parsed.length > best.length) {
        best = parsed;
        bestSheet = sheetName;
      }
    } catch {
      // try next sheet
    }
  }

  if (best.length === 0) {
    throw new Error(
      `No sheet in the XLSX matched. Sheets tried: ${wb.SheetNames.join(", ")}`
    );
  }
  console.log(`   Using sheet: "${bestSheet}" (${best.length} mappings)\n`);
  return best;
}

// ---------- main ----------

async function main() {
  console.log("=== ProEd Coder AI — HCC V28 Crosswalk Seed ===\n");

  const file = findDataFile();
  console.log(`📖 Reading ${file}...`);

  const isXlsx = file.toLowerCase().endsWith(".xlsx");
  const mappings: Mapping[] = isXlsx
    ? await parseXlsx(file)
    : parseCsv(fs.readFileSync(file, "utf8"));

  console.log(`   ✓ Parsed ${mappings.length} ICD-10 → HCC V28 mappings\n`);

  if (mappings.length === 0) {
    console.error("No mappings found. Check the file format.");
    process.exit(1);
  }

  // Load the HCC V28 category names lookup (data/hcc-v28-names.json).
  // The CMS crosswalk file only has HCC numbers, not names — so we map
  // numeric HCC → category label from this reference file.
  //
  // Cards show "HCC 37 · Diabetes with Chronic Complications" when a name
  // is found; otherwise just "HCC 37". Populate the file over time as
  // you verify V28 category names from the CMS Rate Announcement.
  const NAMES_PATH = path.join(DATA_DIR, "hcc-v28-names.json");
  let hccNames: Record<string, string> = {};
  if (fs.existsSync(NAMES_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(NAMES_PATH, "utf8"));
      // Accept either flat {"37": "..."} or nested {"_examples_seed": {"37": "..."}} format
      const flat: Record<string, unknown> =
        raw._examples_seed && typeof raw._examples_seed === "object"
          ? { ...raw._examples_seed, ...raw }
          : raw;
      for (const [k, v] of Object.entries(flat)) {
        if (!k.startsWith("_") && typeof v === "string") hccNames[k] = v;
      }
      const count = Object.keys(hccNames).length;
      console.log(`   ✓ Loaded ${count} HCC category names\n`);
    } catch {
      console.warn(`   ⚠️  Could not parse ${NAMES_PATH} — HCC names will be blank\n`);
    }
  } else {
    console.warn(
      `   ⚠️  ${NAMES_PATH} missing — cards will show "HCC 37" without a category name\n`
    );
  }

  await wakeDB();

  console.log("🩺 Updating MedicalCode rows with HCC data...");
  let matched = 0;
  let unmatched = 0;

  for (let i = 0; i < mappings.length; i += UPDATE_BATCH) {
    const batch = mappings.slice(i, i + UPDATE_BATCH);
    const results: number[] = [];

    // Prisma's default connection pool is 5. Fan out at most 5 concurrent
    // updateMany calls at a time so we don't queue past the pool timeout.
    const CONCURRENT = 5;
    for (let j = 0; j < batch.length; j += CONCURRENT) {
      const chunk = batch.slice(j, j + CONCURRENT);
      const chunkResults = await withRetry(() =>
        Promise.all(
          chunk.map(async (m) => {
            // Look up the OFFICIAL HCC category name (e.g. "Diabetes with
            // Chronic Complications"). Ignore m.hccLabel — CMS's crosswalk
            // doesn't carry HCC names, only ICD descriptions, which would
            // duplicate the code's own description.
            const officialName = hccNames[m.hcc];
            const category = officialName
              ? `HCC ${m.hcc} · ${officialName}`
              : `HCC ${m.hcc}`;
            const data: { hccCategory: string; hccWeight?: number } = {
              hccCategory: category,
            };
            if (m.coefficient != null) data.hccWeight = m.coefficient;

            const r = await db.medicalCode.updateMany({
              where: { codeSystem: "ICD10CM", code: m.icd10 },
              data,
            });
            return r.count;
          })
        )
      );
      results.push(...chunkResults);
    }

    for (const c of results) {
      if (c > 0) matched++;
      else unmatched++;
    }

    const done = Math.min(i + UPDATE_BATCH, mappings.length);
    if (i % (UPDATE_BATCH * 10) === 0 || done >= mappings.length) {
      console.log(
        `   ${done}/${mappings.length}  matched: ${matched}  unmatched: ${unmatched}`
      );
    }
  }

  console.log(`\n   ✓ ${matched} ICD-10 codes now carry HCC risk data`);
  if (unmatched > 0) {
    console.log(
      `   ℹ️  ${unmatched} mappings skipped (code not present in our ICD-10 seed)`
    );
  }

  const withHcc: Array<{ n: bigint }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS n FROM "MedicalCode" WHERE "hccCategory" IS NOT NULL`
  );
  console.log(`\n✅ Seed complete — ${withHcc[0].n} codes have HCC data.\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
