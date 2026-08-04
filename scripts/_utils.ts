/**
 * Shared helpers for seed scripts.
 */

import { db } from "../lib/db";

/**
 * Retry a DB call with exponential backoff on transient Neon errors.
 * Same pattern as scripts/seed-icd10.ts, extracted so all Phase 3 scripts share it.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX = 8;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; name?: string };
      const errClass =
        (err as { constructor?: { name?: string } })?.constructor?.name ??
        e.name ??
        "";
      const msg = e.message ?? "";
      const isTransient =
        errClass.includes("Initialization") ||
        errClass.includes("Rust") ||
        e.code === "P1001" ||
        e.code === "P1002" ||
        e.code === "P1008" ||
        e.code === "P1017" ||
        e.code === "P2024" ||
        /can'?t reach|connection|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
          msg
        );
      if (!isTransient || attempt === MAX - 1) throw err;
      const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
      console.log(
        `\n   ⚠️  DB unreachable, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${MAX})...`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

/**
 * Warm up the Neon connection before starting.
 */
export async function wakeDB() {
  console.log("🔌 Waking Neon compute...");
  await withRetry(async () => {
    await db.$queryRaw`SELECT 1`;
  });
  console.log("   ✓ Database ready\n");
}

/**
 * Normalize an ICD-10 code by stripping the decimal point.
 * CMS crosswalks sometimes use "E11.40", the CDC order file uses "E1140".
 * Our DB stores the dotless form; use this before matching.
 */
export function normalizeIcd10(code: string): string {
  return code.trim().replace(/\./g, "").toUpperCase();
}
