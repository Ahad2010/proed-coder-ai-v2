/**
 * Phase 3.4 — HEDIS Measure Tagging
 *
 * Tags existing MedicalCode rows with which HEDIS measure(s) they help
 * close. Reads data/hedis-measures.json (curated demo data) and does
 * bulk UPDATE per measure using the IN clause.
 *
 * Codes that belong to multiple measures get a comma-separated tag,
 * e.g. "CDC, SUPD" for a diabetes code that's in both measures.
 *
 * ---
 *
 * LICENSING NOTE:
 *   NCQA HEDIS Value Sets are commercially licensed by NCQA.
 *   This seed uses a CURATED demo set based on public technical
 *   specifications. Safe for demo/MVP. For production, ProEd should
 *   subscribe to NCQA's official value sets and replace the JSON.
 *
 * Run:
 *   npm run seed:hedis
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { withRetry, wakeDB, normalizeIcd10 } from "./_utils";

const DATA_FILE = path.join("./data", "hedis-measures.json");
const UPDATE_BATCH = 50;

type Measure = {
  code: string;
  name: string;
  description?: string;
  icd10?: string[];
  hcpcs?: string[];
  cpt?: string[];
};

// ---------- load ----------

function loadMeasures(): Measure[] {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ Missing ${DATA_FILE}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return (raw.measures ?? []) as Measure[];
}

// ---------- pivot ----------

type CodeKey = { code: string; codeSystem: "ICD10CM" | "HCPCS" | "CPT" };

/**
 * Build a map: "codeSystem:code" → sorted array of measure abbrevs
 */
function buildCodeToMeasuresMap(
  measures: Measure[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const addTag = (system: string, code: string, measure: string) => {
    const key = `${system}:${code}`;
    const existing = map.get(key) ?? [];
    if (!existing.includes(measure)) existing.push(measure);
    map.set(key, existing);
  };

  for (const m of measures) {
    for (const c of m.icd10 ?? []) addTag("ICD10CM", normalizeIcd10(c), m.code);
    for (const c of m.hcpcs ?? []) addTag("HCPCS", c.trim().toUpperCase(), m.code);
    for (const c of m.cpt ?? []) addTag("CPT", c.trim(), m.code);
  }
  return map;
}

// ---------- update ----------

async function applyTags(codeMap: Map<string, string[]>) {
  const entries = Array.from(codeMap.entries()).map(([key, tags]) => {
    const [system, code] = key.split(":") as [CodeKey["codeSystem"], string];
    return { system, code, tag: tags.sort().join(", ") };
  });

  console.log(`   ${entries.length} codes to tag\n`);

  let matched = 0;
  let unmatched = 0;

  for (let i = 0; i < entries.length; i += UPDATE_BATCH) {
    const batch = entries.slice(i, i + UPDATE_BATCH);
    const results: number[] = [];

    const CONCURRENT = 5;
    for (let j = 0; j < batch.length; j += CONCURRENT) {
      const chunk = batch.slice(j, j + CONCURRENT);
      const chunkResults = await withRetry(() =>
        Promise.all(
          chunk.map(async (e) => {
            const r = await db.medicalCode.updateMany({
              where: { codeSystem: e.system, code: e.code },
              data: { hedisMeasure: e.tag },
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

    const done = Math.min(i + UPDATE_BATCH, entries.length);
    if (i % (UPDATE_BATCH * 5) === 0 || done >= entries.length) {
      console.log(`   ${done}/${entries.length}  matched: ${matched}  unmatched: ${unmatched}`);
    }
  }

  return { matched, unmatched };
}

// ---------- main ----------

async function main() {
  console.log("=== ProEd Coder AI — HEDIS Measure Tagging ===\n");

  console.log("📖 Loading HEDIS measures...");
  const measures = loadMeasures();
  console.log(`   ✓ Loaded ${measures.length} measures:`);
  for (const m of measures) {
    const total =
      (m.icd10?.length ?? 0) + (m.hcpcs?.length ?? 0) + (m.cpt?.length ?? 0);
    console.log(`     ${m.code.padEnd(6)} ${m.name.padEnd(50)}  (${total} codes)`);
  }
  console.log("");

  console.log("🔧 Building code → measures map...");
  const codeMap = buildCodeToMeasuresMap(measures);
  console.log(`   ✓ ${codeMap.size} unique codes across all measures\n`);

  await wakeDB();

  console.log("🏷️  Tagging MedicalCode rows...");
  const { matched, unmatched } = await applyTags(codeMap);

  console.log(`\n   ✓ ${matched} codes now carry a HEDIS tag`);
  if (unmatched > 0) {
    console.log(`   ℹ️  ${unmatched} codes skipped (not present in DB — e.g. CPT ranges not in our seed)`);
  }

  const tagged: Array<{ n: bigint }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS n FROM "MedicalCode" WHERE "hedisMeasure" IS NOT NULL`
  );
  console.log(`\n✅ Seed complete — ${tagged[0].n} codes have HEDIS tags.\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());