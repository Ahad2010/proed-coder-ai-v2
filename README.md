# ProEd Coder AI

AI-powered medical coding & policy assistant for **ProEd Consulting & Staffing**.
Built by **AXCEL**.

Two tracks in one app:

- **Track A — Codes Lookup**: semantic search over ICD-10-CM, HCPCS, CPT with HCC/HEDIS mapping
- **Track B — Query Form Generation**: LLM drafts compliant physician queries grounded in CMS, NCQA, HHS, Medicaid, and eClinicalWorks policies + existing form patterns

---

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- Postgres 16 + vector
- Prisma ORM
- **LLM: Groq free tier (default) → Claude Sonnet (production swap)**
  - Provider is swappable via `LLM_PROVIDER` env var — no code changes
  - Groq model default: `llama-3.3-70b-versatile`
  - Anthropic model default: `claude-sonnet-4-5`
- **Embeddings: Xenova local (default, free) → OpenAI (production swap)**
  - Provider is swappable via `EMBEDDING_PROVIDER` env var
  - Xenova model default: `Xenova/bge-small-en-v1.5` (384 dims, runs in Node via `@huggingface/transformers`)
  - OpenAI `text-embedding-3-small` with `dimensions=384` — matches vector column, no schema change
- NextAuth v5 (email magic link)
- Docker Compose for local dev
- Hetzner + Cloudflare for production

**Zero paid API keys required for MVP development.** Groq + Xenova = free forever until you decide to scale.

---

## Phase 1 — Foundation (Week 1)

You are here. This scaffold gives you:

- Repo structure, TypeScript, Tailwind
- Postgres + pgvector via Docker
- Prisma schema for codes, policies, forms, users, audit log
- Vector migration for pgvector columns + HNSW indexes
- Landing page with search bar
- `/api/search` route with intent classification (Groq LLM) + pgvector cosine search
- Provider-agnostic LLM lib (`lib/llm.ts`) — Groq free tier by default, one env var to swap to Claude
- OpenAI embeddings helper
- Placeholder seed script for ICD-10

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres + pgvector
npm run docker:up

# 3. Copy env template. For MVP dev you only need GROQ_API_KEY (free).
#    Xenova embeddings run locally, no key needed.
#    Get Groq key: https://console.groq.com
#    Later swap LLM_PROVIDER + EMBEDDING_PROVIDER for production scale.
cp .env.example .env

# 4. Apply Prisma schema
npm run db:push

# 5. Apply pgvector SQL migration
docker exec -i proed-postgres psql -U proed -d proed_coder_ai < prisma/migrations/0001_pgvector_columns.sql

# 6. Run dev server
npm run dev
```

Open `http://localhost:3000`. Search will run intent classification but return zero results until Phase 2 seeds data.

---

## Phase Roadmap

| # | Phase | Duration | Status |
|---|---|---|---|
| 1 | Foundation | Week 1 | ✅ Live |
| 2 | Track A MVP — ICD-10 Lookup | Week 2 | 🔧 Seed pipeline ready |
| 3 | Track A Full — HCPCS + CPT + HCC | Week 3 | ⏳ Next |
| 4 | Track B — Query Form Generation | Weeks 4–5 | |
| 5 | Multi-user + HIPAA | Week 6 | |
| 6 | Deploy + Handover | Weeks 7–8 | |

---

## Phase 2 — Load Real Data

Populate the database with the full ICD-10-CM 2026 code set from CMS.

```bash
# 1. Install the new dep (adm-zip)
npm install

# 2. Run the seed pipeline
npm run seed:icd10
```

That single command:

- Downloads the official ICD-10-CM 2026 ZIP from CDC's CMS mirror
- Extracts and parses ~72k codes
- Upserts them into `MedicalCode` (batched, ~5 min)
- Embeds every description with the current provider (Xenova by default)
- Writes 384-dim vectors into the pgvector column

### Embedding Time — Two Options

| Provider | Time for ~72k codes | Cost |
|---|---|---|
| **Xenova** (default, local CPU) | 1–2 hours | Free |
| **OpenAI** (temporary swap) | 5–10 minutes | ~$0.50 |

To use OpenAI temporarily just for the seed:

```env
EMBEDDING_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
```

Run `npm run seed:icd10`, then flip `EMBEDDING_PROVIDER` back to `xenova`. Vectors are already written to the DB — no re-embed needed.

### Verify

After seeding, search for `Type 2 diabetes with neuropathy` in the app. You should see real code cards for `E11.40`, `E11.41`, `E11.42`, etc.

Or run in `db:studio` and check the row count on `MedicalCode`.

---

## Phase 3+ — Roadmap

---

## Directory

```
proed-coder-ai/
├── app/
│   ├── api/search/route.ts       # search endpoint (intent + pgvector)
│   ├── layout.tsx
│   ├── page.tsx                  # search UI
│   └── globals.css
├── lib/
│   ├── db.ts                     # Prisma singleton
│   ├── llm.ts                    # Groq (default) or Anthropic — swap via LLM_PROVIDER env
│   └── embeddings.ts             # Xenova (default, local, free) or OpenAI — swap via EMBEDDING_PROVIDER
├── prisma/
│   ├── schema.prisma             # DB schema (Prisma)
│   └── migrations/
│       └── 0001_pgvector_columns.sql  # vector columns + HNSW indexes
├── scripts/
│   └── seed-icd10.ts             # Phase 2 task
├── docker-compose.yml            # Postgres + pgvector locally
├── package.json
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── .env.example
```

---

Built by **AXCEL** · [axcelworld.com](https://axcelworld.com)
