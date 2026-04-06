# llm-kb — Phase 1 Build Plan

> Emergent design. Each slice is a thin vertical slice that works end-to-end, is demoable, and informs the next step. Decisions are made at the last responsible moment.

## Key Learnings
- **PDF is the only adapter we build.** Everything else (Excel, Word, PPT, CSV, images) handled dynamically by Pi SDK agent at query time.
- **`@llamaindex/liteparse`** proven (from parser-study). Extracts text + bounding boxes locally.
- **Two-output pattern**: `.md` (spatial text) + `.json` (bounding boxes for citations).
- **OCR off by default.** Most PDFs have native text. Enable via `OCR_SERVER_URL` or `OCR_ENABLED=true`.
- **Pi SDK `createAgentSession()`** with defaults — no auth/model config needed. Uses Pi's existing auth.
- **AGENTS.md injected via `agentsFilesOverride`** — user's folder stays clean.
- **NODE_PATH** set so agent's bash scripts can use bundled libraries (exceljs, mammoth, officeparser).
- **Config file skipped** — nothing reads it yet. Add when Phase 2/3 needs it.

---

## Slice 1: "Hello World" CLI ✅
Commander CLI with `run <folder>`. Scans folder, lists files by extension.

## Slice 2: PDF → markdown + bounding boxes ✅
LiteParse parses PDFs → `.md` + `.json` in `.llm-kb/wiki/sources/`. Tested on 9 real PDFs (1000+ pages).

## Slice 3: Scanned PDF handling (OCR) ✅
LiteParse has Tesseract.js built-in. `ocrEnabled` + `ocrServerUrl` config. OCR off by default. Azure OCR bridge tested on 16 legal PDFs (3000+ pages).

## Slice 4: Progress + error handling ✅
Inline progress. Stderr suppression. Corrupt file skip + warning. Mtime check — re-runs instant.

## Slice 5: Indexer (Pi SDK) ✅
`createAgentSession` with cwd = user's folder. AGENTS.md injected. Agent reads sources, writes `index.md` with summary table.

## Slice 6: File watcher ✅
chokidar watches folder. New/changed PDFs → parse → re-index. 2s debounce for batch drops.

## Slice 7: Config + polish → Skipped
Config file has no readers yet. Deferred to Phase 2/3. README updated instead.

---

## Phase 1 Complete ✅

**What ships:**
- `llm-kb run ./folder` — scan, parse PDFs, build index, watch for new files
- Pre-bundled libraries for agent to handle Excel, Word, PowerPoint at query time
- OCR via env var (local Tesseract or remote Azure bridge)
- Auth via Pi SDK (zero config)

**Phase 2 complete ✅:**
- `llm-kb query "question"` — auto-detects KB, streams cited answers
- `--save` flag — research mode, saves to `outputs/`, re-indexes
- Query mode is read-only (read tool only). Research mode adds bash + write.

---

## Phase 3: Auth Fix + Eval Loop + LLM Config

> Full spec: `PHASE3_SPEC.md`
> **Trigger:** 182 LinkedIn saves — people coming back to try `npx llm-kb run` this week.

### Why now
- **Auth fix is urgent.** Users hit a wall if Pi SDK isn't installed. `ANTHROPIC_API_KEY` must work as fallback.
- **Eval loop is the differentiator.** Nobody else building llm-wiki scripts has traces + citation checking.
- **Model config cuts cost.** Haiku for indexing (10x cheaper than Sonnet). Users shouldn't pay Sonnet prices for one-line summaries.

### Build order

## Slice 1: Auth fix 🔴 DO FIRST

Check auth before creating any session. Support two paths:

```
npx llm-kb run ./docs
  ├─ ~/.pi/agent/auth.json exists? → Pi SDK auth. Done.
  ├─ ANTHROPIC_API_KEY set? → Configure Pi SDK programmatically. Done.
  └─ Neither? → Clear error:
       No LLM authentication found.
       Option 1: npm install -g @mariozechner/pi-coding-agent && pi
       Option 2: export ANTHROPIC_API_KEY=sk-ant-...
```

Definition of done:
- [ ] `ANTHROPIC_API_KEY=sk-... npx llm-kb run ./docs` works without Pi installed
- [ ] Pi SDK auth works as before (no regression)
- [ ] Clear error when neither is available
- [ ] README updated with both auth options

## Slice 2: LLM config

Auto-generate `.llm-kb/config.json` on first run:

```json
{
  "indexModel": "claude-haiku-3-5",
  "queryModel": "claude-sonnet-4-20250514",
  "provider": "anthropic"
}
```

Env var overrides: `LLM_KB_INDEX_MODEL`, `LLM_KB_QUERY_MODEL`
Priority: env var → config file → defaults

Definition of done:
- [ ] Config auto-generated on first run
- [ ] Haiku for indexing, Sonnet for query by default
- [ ] Env vars override config
- [ ] `llm-kb status` shows current model config

## Slice 3: Trace logging

Every query logs JSON to `.llm-kb/traces/`:

```json
{
  "id": "2026-04-06T14-30-00-query",
  "timestamp": "2026-04-06T14:30:00Z",
  "question": "what are the reserve requirements?",
  "mode": "query",
  "filesRead": ["index.md", "reserve-policy.md"],
  "filesSkipped": ["board-deck.md", "pipeline.md"],
  "answer": "Reserve requirements are defined in...",
  "citations": [
    { "file": "reserve-policy.md", "location": "p.3", "claim": "Minimum reserve ratio of 12%" }
  ],
  "durationMs": 4200
}
```

Capture via `session.subscribe()` — intercept tool calls to track `filesRead`.

Definition of done:
- [ ] Every query writes a trace JSON to `.llm-kb/traces/`
- [ ] Trace includes: question, mode, filesRead, filesSkipped, answer, citations, durationMs

## Slice 4: `llm-kb status`

```
Knowledge Base: ./research/.llm-kb/
  Sources: 12 files (8 PDF, 2 XLSX, 1 DOCX, 1 TXT)
  Index: 12 entries, last updated 2 min ago
  Outputs: 3 saved research answers
  Traces: 47 queries logged
  Model: claude-sonnet-4 (query), claude-haiku-3-5 (index)
  Auth: Pi SDK
```

Definition of done:
- [ ] `llm-kb status` prints KB stats, auth method, model config, trace count

## Slice 5: `llm-kb eval`

Pi SDK session (read-only) that:
1. Reads trace files from `.llm-kb/traces/`
2. For each trace checks: citation validity, missing sources, answer consistency
3. Writes report to `.llm-kb/wiki/outputs/eval-report.md`
4. Watcher detects report, re-indexes

```bash
llm-kb eval --folder ./research
llm-kb eval --folder ./research --last 20
```

Definition of done:
- [ ] `llm-kb eval` reads traces and writes eval-report.md
- [ ] Flags: invalid citations, skipped-but-relevant files, answer contradictions
- [ ] Report gets re-indexed by watcher

## Slice 6: Blog Part 4

- Write AFTER `llm-kb eval` runs on real data
- Show actual eval-report.md output
- Title: "How llm-kb Knows When It Got It Wrong"

---

## Phase 3 Definition of Done

- [ ] `ANTHROPIC_API_KEY` works without Pi SDK installed
- [ ] Clear error when no auth found
- [ ] Config file with model selection (index vs query model)
- [ ] Every query logs a trace JSON to `.llm-kb/traces/`
- [ ] `llm-kb eval` checks citations and writes report
- [ ] `llm-kb status` shows KB stats + config + auth
- [ ] README updated with auth options + eval command
- [ ] Blog Part 4 written with real eval output

---

## Phase 4: Wiki Compilation (The Farzapedia Pattern)

> **Insight:** Farza's implementation is what Karpathy called the best version. The key isn't just indexing sources — it's compiling them into a **concept-organized wiki** with backlinked articles. The agent navigates concepts, not raw files.
>
> Current llm-kb: agent reads source summaries → picks source files → answers from raw docs.
> Wiki pattern: agent reads concept articles → drills into specific articles → answers from synthesized knowledge.

### The Structural Shift

**Current (source-organized):**
```
sources/lease-castlelake.md    ─┐
sources/lease-genesis.md       ─┤→ index.md (flat table, one row per source)
sources/maintenance-manual.md  ─┘
```

**Wiki (concept-organized):**
```
sources/lease-castlelake.md    ─┐
sources/lease-genesis.md       ─┤→ articles/reserve-requirements.md
sources/maintenance-manual.md  ─┘   articles/key-parties.md
                                      articles/engine-types.md
                                      articles/maintenance-obligations.md
                                      index.md (catalog of ARTICLES with backlinks)
```

Farza's quote: *"The structure of the wiki files and how it's all backlinked is very easily crawlable by any agent. Starting at index.md, the agent does a really good job at drilling into the specific pages it needs."*

Karpathy's quote: *"I thought I had to reach for fancy RAG, but the LLM has been pretty good about auto-maintaining index files and brief summaries of all the documents and it reads all the important related data fairly easily at this ~small scale."*

### New Command

```bash
llm-kb compile ./folder
```

Or auto-triggered after indexing when `--wiki` flag is passed:

```bash
llm-kb run ./folder --wiki   # parse + index + compile wiki
```

### Wiki Directory Structure

```
.llm-kb/
  wiki/
    sources/          # raw parsed files (unchanged)
    articles/         # NEW: concept-organized articles
      concepts/       # thematic articles (reserve-requirements.md, etc)
      entities/       # people, companies, assets
      timeline.md     # chronological view of events
    index.md          # NOW points to articles, not sources
    source-index.md   # OLD flat source table (kept for reference)
```

### How Compile Works

1. LLM reads ALL source files (via existing sources/ dir)
2. LLM identifies key concepts, entities, and themes
3. LLM writes one markdown article per concept — like a Wikipedia entry
4. Each article has:
   - Description (synthesized from multiple sources)
   - Backlinks to related articles: `[[reserve-requirements]]`, `[[key-parties]]`
   - Source citations: `(Source: lease-castlelake.md, p.3)`
5. Writes `articles/index.md` — catalog of all articles with one-line descriptions

### Incremental Updates (The Compounding Part)

When a new source is added (watcher detects it):
1. Parse it → sources/
2. LLM reads new source + `articles/index.md`
3. LLM updates 2-3 most relevant existing articles where new content fits
4. OR creates a new article if the topic is genuinely new
5. Updates `articles/index.md` catalog

Farza: *"The most magical thing now is as I add new things, the system updates 2-3 different articles where it feels the context belongs, or just creates a new article. Like a super genius librarian."*

### Query Change

With wiki mode active, query agent reads `articles/index.md` (concept catalog) instead of `source-index.md` (source table). Agent drills into concept articles, gets synthesized cross-referenced answers.

Fallback: if no articles compiled yet, falls back to source-index behavior.

### Blog Post

Part 5 or 6: *"Why Your Knowledge Base Needs a Librarian, Not a Search Engine"*
- Show the before/after: flat source index vs concept wiki
- Show Farza's insight: built for agents, not humans
- Show the compounding: add one doc, 3 articles updated automatically
- Live demo: `llm-kb compile` on a real document set

### Why This Matters for llm-kb

- Karpathy publicly called this the best implementation of his pattern
- Farza has **no public code** — llm-kb ships it as `npx llm-kb compile`
- Farzapedia got **920K views** on Farza's tweet, **Karpathy quote-tweeted** it at **920K views**
- First open-source implementation of the exact pattern Karpathy validated
- Blog post can reference both tweets legitimately ("inspired by Farza's Farzapedia")

### Definition of Done (Phase 4)

- [ ] `llm-kb compile ./folder` reads sources and writes articles/ directory
- [ ] Each article is a proper markdown file with backlinks and source citations
- [ ] `articles/index.md` is a concept catalog (not a source table)
- [ ] Watcher triggers incremental article updates when new source added
- [ ] Query uses article index when available, falls back to source index
- [ ] `llm-kb status` shows: X sources, Y articles, last compiled
- [ ] Blog Part 5 written: concept wiki vs flat index, Farzapedia reference

---

*Phase 4 added April 6, 2026 — inspired by Farzapedia (@FarzaTV), highlighted by Karpathy as best implementation of the LLM wiki pattern. 920K views on Farza's tweet, Karpathy quote-tweet at 920K views.*
