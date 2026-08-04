-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding columns (384 dims — matches Xenova bge-small-en-v1.5
-- and OpenAI text-embedding-3-small with dimensions=384)
ALTER TABLE "MedicalCode"    ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE "PolicyDocument" ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE "PolicyChunk"    ADD COLUMN IF NOT EXISTS embedding vector(384);

-- HNSW indexes for fast semantic search (cosine distance)
CREATE INDEX IF NOT EXISTS medicalcode_embedding_idx
  ON "MedicalCode" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS policydoc_embedding_idx
  ON "PolicyDocument" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS policychunk_embedding_idx
  ON "PolicyChunk" USING hnsw (embedding vector_cosine_ops);
