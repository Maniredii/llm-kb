import { getModels, completeSimple } from "@mariozechner/pi-ai";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { KBTrace } from "./trace-builder.js";

/** Resolve the Anthropic API key from auth storage or env */
async function resolveApiKey(authStorage?: AuthStorage): Promise<string | undefined> {
  if (authStorage) {
    return authStorage.getApiKey("anthropic");
  }
  // Fall back to Pi SDK file-based auth
  const piAuthPath = join(homedir(), ".pi", "agent", "auth.json");
  if (existsSync(piAuthPath)) {
    const storage = AuthStorage.create(piAuthPath);
    return storage.getApiKey("anthropic");
  }
  return process.env.ANTHROPIC_API_KEY;
}

function buildPrompt(
  question: string,
  answer: string,
  sources: string,
  date: string,
  currentWiki: string
): string {
  if (currentWiki.trim()) {
    return `You are maintaining a knowledge wiki for a document collection.

## Current wiki
${currentWiki}

## New Q&A to integrate
**Question:** ${question}
**Sources:** ${sources}  
**Date:** ${date}

**Answer:**
${answer}

---

Update the wiki to integrate this new knowledge. Rules:
- Use ## for top-level topic (source document name, e.g. "## Bankers Books Evidence Act, 1891")
- Use ### for subtopics (e.g. "### Key Sections", "### Definitions", "### Overview")
- Group related knowledge under the right subtopic — not just the verbatim question
- If topic/subtopic already exists, expand or update — never duplicate
- Be concise: bullet points for lists, short prose for explanations
- Preserve all existing content
- End each ## section with: *Sources: X · date*
- Separate ## sections with: ---

Return ONLY the complete updated wiki markdown. No explanation.`;
  }

  return `You are creating a knowledge wiki for a document collection.

## First Q&A to add
**Question:** ${question}
**Sources:** ${sources}
**Date:** ${date}

**Answer:**
${answer}

---

Create a clean wiki. Rules:
- Start with exactly: # Knowledge Wiki\\n\\n> Auto-generated knowledge base. Updated after each query.\\n\\n---\\n
- Use ## for top-level topic (source document name, e.g. "## Bankers Books Evidence Act, 1891")
- Use ### for subtopics (e.g. "### Key Sections", "### Definitions", "### Overview")
- Be concise: bullet points for lists, short prose for explanations
- End each ## section with: *Sources: X · date*

Return ONLY the wiki markdown. No explanation.`;
}

/**
 * Update .llm-kb/wiki/wiki.md using a direct LLM call (no agent tools).
 * We handle all file I/O ourselves — read current wiki, call Haiku, write result.
 */
export async function updateWiki(
  kbRoot: string,
  trace: KBTrace,
  authStorage?: AuthStorage,
  indexModelId = "claude-haiku-4-5"
): Promise<void> {
  if (trace.mode !== "query" || !trace.question || !trace.answer) return;

  const wikiDir = join(kbRoot, ".llm-kb", "wiki");
  await mkdir(wikiDir, { recursive: true });
  const wikiPath = join(wikiDir, "wiki.md");

  // Read current wiki (if any)
  const currentWiki = existsSync(wikiPath)
    ? await readFile(wikiPath, "utf-8").catch(() => "")
    : "";

  // Derive sources from files read (exclude index/wiki themselves)
  const sources = trace.filesRead
    .map((f) => f.split(/[\\/]/).pop() ?? f)
    .filter((f) => f.endsWith(".md") && f !== "index.md" && f !== "wiki.md")
    .join(", ") || "unknown";

  const date = new Date(trace.timestamp).toISOString().slice(0, 10);
  const prompt = buildPrompt(trace.question, trace.answer, sources, date, currentWiki);

  // Resolve API key
  const apiKey = await resolveApiKey(authStorage);
  if (!apiKey) return; // can't update wiki without auth

  // Find Haiku model
  const model = getModels("anthropic").find((m) => m.id === indexModelId);
  if (!model) return;

  // Direct LLM call — no agent, no tools
  const result = await completeSimple(
    model,
    {
      systemPrompt: "You are a precise technical writer maintaining a structured knowledge wiki. Return only clean markdown.",
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    },
    { apiKey }
  );

  // Extract text from response
  const text = result.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("")
    .trim();

  if (text) {
    await writeFile(wikiPath, text + "\n", "utf-8");
  }
}
