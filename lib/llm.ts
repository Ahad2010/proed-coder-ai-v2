/**
 * Provider-agnostic LLM interface.
 *
 * Switch providers with the LLM_PROVIDER env var:
 *   LLM_PROVIDER="groq"       → free tier, default for MVP
 *   LLM_PROVIDER="anthropic"  → paid, use for production once revenue justifies it
 *
 * Both providers implement the same public functions:
 *   - classifyIntent(query)   → route Track A vs Track B
 *   - (Phase 4) generateQueryForm(scenario, policyContext)
 */

import Groq from "groq-sdk";
import Anthropic from "@anthropic-ai/sdk";

export type Intent = "codes" | "query_form" | "policy";

const provider = (process.env.LLM_PROVIDER ?? "groq").toLowerCase();

// Lazily instantiated so build-time module evaluation (Next.js "collecting
// page data") never fails due to a missing API key — the key only needs to
// exist when an actual request comes in at runtime.
let groq: Groq | null = null;
let anthropic: Anthropic | null = null;

function getGroq(): Groq {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY environment variable is missing or empty.");
    }
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
}

function getAnthropic(): Anthropic {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY environment variable is missing or empty.");
    }
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";

const CLASSIFIER_SYSTEM =
  "You are a router for a medical coding assistant. Classify the user query into exactly ONE label:\n" +
  "- `codes`: they want ICD-10, HCPCS, or CPT codes (diagnoses, procedures, supplies)\n" +
  "- `query_form`: they want to draft or find a physician query form\n" +
  "- `policy`: they want a policy document, guideline, or measure specification\n\n" +
  "Respond with only the label, nothing else.";

/**
 * Classify a coder's natural-language query into a track.
 */
export async function classifyIntent(query: string): Promise<Intent> {
  let raw = "codes";

  if (provider === "groq") {
    const res = await getGroq().chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM },
        { role: "user", content: query },
      ],
      max_tokens: 16,
      temperature: 0,
    });
    raw = res.choices[0]?.message?.content?.trim().toLowerCase() ?? "codes";
  } else if (provider === "anthropic") {
    const res = await getAnthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: query }],
    });
    raw =
      res.content.find((c) => c.type === "text")?.text?.trim().toLowerCase() ??
      "codes";
  } else {
    throw new Error(
      `LLM provider "${provider}" not configured. Set LLM_PROVIDER + corresponding API key.`
    );
  }

  if (raw.startsWith("query")) return "query_form";
  if (raw.startsWith("policy")) return "policy";
  return "codes";
}

/**
 * Low-level chat completion — used by Phase 4 query form generator.
 * Same signature across providers.
 */
export async function chat(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.2;

  if (provider === "groq") {
    const res = await getGroq().chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      max_tokens: maxTokens,
      temperature,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  if (provider === "anthropic") {
    const res = await getAnthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      temperature,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    return res.content.find((c) => c.type === "text")?.text ?? "";
  }

  throw new Error(`LLM provider "${provider}" not configured.`);
}

export const CURRENT_PROVIDER = provider;
export const CURRENT_MODEL = provider === "groq" ? GROQ_MODEL : CLAUDE_MODEL;