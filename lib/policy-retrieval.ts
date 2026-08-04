/**
 * Policy retrieval — vector search over PolicyChunk for RAG citations.
 * Used by /api/query-form/generate to ground drafts in real policy text.
 */

import { db } from "@/lib/db";
import { embed, toPgVector } from "@/lib/embeddings";

export type PolicyChunkResult = {
  chunkId: string;
  policyDocId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  docTitle: string;
  sourceName: string;
  sourceUrl: string;
};

/**
 * Retrieve the top-K policy chunks most semantically similar to a query.
 * Used to ground query-form generation in real AHIMA/CMS/NCQA policy text.
 */
export async function retrievePolicyChunks(
  queryText: string,
  k = 4
): Promise<PolicyChunkResult[]> {
  const vec = await embed(queryText);
  const pg = toPgVector(vec);

  const rows: PolicyChunkResult[] = await db.$queryRawUnsafe(
    `SELECT pc.id           AS "chunkId",
            pc."policyDocId"  AS "policyDocId",
            pc."chunkIndex"   AS "chunkIndex",
            pc.content        AS content,
            1 - (pc.embedding <=> $1::vector) AS similarity,
            pd.title          AS "docTitle",
            pd."sourceName"   AS "sourceName",
            pd."sourceUrl"    AS "sourceUrl"
       FROM "PolicyChunk" pc
       JOIN "PolicyDocument" pd ON pd.id = pc."policyDocId"
      WHERE pc.embedding IS NOT NULL
      ORDER BY pc.embedding <=> $1::vector
      LIMIT ${k};`,
    pg
  );
  return rows;
}
