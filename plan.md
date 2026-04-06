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
