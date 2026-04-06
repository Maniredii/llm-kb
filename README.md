# llm-kb

Drop files into a folder. Get a knowledge base you can query — with a self-improving wiki that gets smarter every time you ask.

Inspired by [Karpathy's LLM Knowledge Bases](https://x.com/karpathy/status/2039805659525644595) and [Farzapedia](https://x.com/FarzaTV).

## Quick Start

```bash
npm install -g llm-kb
llm-kb run ./my-documents
```

That's it. PDFs get parsed, an index is built, and an interactive chat opens — ready for questions.

## Authentication

Two options (you need one):

**Option 1 — Pi SDK (recommended)**
```bash
npm install -g @mariozechner/pi-coding-agent
pi   # run once to authenticate
```

**Option 2 — Anthropic API key**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

If neither is configured, `llm-kb` shows a clear error with setup instructions.

## What It Does

### Run — scan, parse, index, chat

```bash
llm-kb run ./my-documents
```

```
llm-kb v0.3.0

Scanning ./my-documents...
  Found 9 files (9 PDF)
  9 parsed

  Building index... (claude-haiku-4-5)
  Index built: .llm-kb/wiki/index.md

Ready. Ask a question or drop files in to re-index.

────────────────────────────────────────────
> What are the key findings?
────────────────────────────────────────────

⟡ claude-sonnet-4-6

▸ Thinking
  Let me check the relevant source files...

  ▸ Reading  q3-report.md
  ▸ Reading  q4-report.md

──────────────────────────────────────────────

## Key Findings
Revenue grew 12% QoQ driven by...
(cited answer with page references)

── 8.3s · 2 files read ──────────────────────
```

**What happens:**
1. **Scans** — finds all supported files (PDF, DOCX, XLSX, PPTX, MD, TXT, CSV, images)
2. **Parses** — PDFs converted to markdown + bounding boxes via [LiteParse](https://github.com/run-llama/liteparse)
3. **Indexes** — Haiku reads sources, writes `index.md` with summary table
4. **Watches** — drop new files while running, they get parsed and indexed automatically
5. **Chat** — interactive TUI with Pi-style markdown rendering, thinking display, tool call progress
6. **Learns** — every answer updates a knowledge wiki; repeated questions answered instantly from cache

### Continuous conversation

The chat maintains full conversation history. Follow-up questions work naturally:

```
> What is BNS 2023?
(detailed answer)

> Tell me more about the mob lynching clause
(agent remembers context — answers about Clause 101 without re-reading)

> How does that compare to the old IPC?
(continues the thread with full context)
```

Sessions persist across restarts — run `llm-kb run` again and the conversation continues.

### Query — single question from CLI

```bash
# Auto-detects .llm-kb/ by walking up from cwd
llm-kb query "compare Q3 vs Q4"

# Explicit folder
llm-kb query "summarize all revenue data" --folder ./my-documents

# Research mode — saves answer and re-indexes
llm-kb query "full analysis of lease terms" --save
```

### Status — KB overview

```bash
llm-kb status
```

```
Knowledge Base Status
  Folder:  /path/to/my-documents
  Sources: 12 parsed sources
  Index:   3 min ago
  Outputs: 2 saved answers
  Models:  claude-sonnet-4-6 (query)  claude-haiku-4-5 (index)
  Auth:    Pi SDK
```

## The Knowledge Wiki

Every query makes the system smarter. After answering, `llm-kb` uses Haiku to update `.llm-kb/wiki/wiki.md` — a structured knowledge wiki organized by topic:

```markdown
## Indian Evidence Act, 1872

### Overview
Foundational legislation covering 167 sections in 3 parts...

### Part I — Relevancy of Facts
Admissions, confessions, dying declarations, expert opinions...

### Electronic Records (Section 65B)
Admissible with certificate from responsible official...

*Sources: Indian Evidence Act.md · 2026-04-06*

---

## Bankers Books Evidence Act, 1891

### Key Sections
Section 4 (core): certified copy = prima facie evidence...
```

When you ask a question already covered by the wiki, the agent answers instantly — no source files read. New questions expand the wiki. The knowledge compounds.

## Model Configuration

Auto-generated at `.llm-kb/config.json`:

```json
{
  "indexModel": "claude-haiku-4-5",
  "queryModel": "claude-sonnet-4-6"
}
```

- **Haiku** for indexing — cheap, fast, good enough for summaries
- **Sonnet** for queries — strong reasoning for cited answers

Override with env vars:
```bash
LLM_KB_INDEX_MODEL=claude-haiku-4-5 llm-kb run ./docs
LLM_KB_QUERY_MODEL=claude-sonnet-4-6 llm-kb query "question"
```

## Non-PDF Files

PDFs are parsed at scan time. Other file types are read dynamically by the agent at query time using bash:

| File type | How it's read |
|---|---|
| `.pdf` | Pre-parsed to markdown + bounding boxes (LiteParse) |
| `.docx` | Agent reads selectively via `adm-zip` (XML structure) |
| `.xlsx` | Agent reads specific sheets/cells via `exceljs` |
| `.pptx` | Agent extracts text via `officeparser` |
| `.md`, `.txt`, `.csv` | Read directly |

For large `.docx` files, the agent reads the document structure first, then extracts only the sections relevant to your question — not the whole file.

## OCR for Scanned PDFs

Most PDFs have native text. For scanned PDFs:

```bash
# Local Tesseract (built-in, slower)
OCR_ENABLED=true llm-kb run ./docs

# Remote Azure OCR (faster, better quality)
OCR_SERVER_URL="http://localhost:8080/ocr?key=KEY" llm-kb run ./docs
```

Native-text pages are always processed locally (free). Only scanned pages hit the OCR server.

## What It Creates

```
./my-documents/
├── (your files — untouched)
└── .llm-kb/
    ├── config.json           ← model configuration
    ├── sessions/             ← conversation history (JSONL)
    ├── traces/               ← per-query traces (JSON)
    │   └── .processed        ← prevents re-processing on restart
    └── wiki/
        ├── index.md          ← source summary table
        ├── wiki.md           ← knowledge wiki (grows over time)
        ├── queries.md        ← query log (newest first)
        ├── sources/          ← parsed markdown + bounding boxes
        └── outputs/          ← saved research answers (--save)
```

Your original files are never modified. Delete `.llm-kb/` to start fresh.

## Display

The interactive TUI (via `@mariozechner/pi-tui`) shows:

| Phase | What you see |
|---|---|
| Model | `⟡ claude-sonnet-4-6` |
| Thinking | `▸ Thinking` + streamed reasoning (dim) |
| Tool calls | `▸ Reading file.md` / `▸ Running bash` + code block |
| Answer | Separator line → markdown rendered with tables, code, headers |
| Done | `── 8.3s · 2 files read ──` |

The `llm-kb query` command uses stdout mode — same phases, streams to terminal, works with pipes.

## Development

```bash
git clone https://github.com/satish860/llm-kb
cd llm-kb
npm install
npm run build
npm link

npm test              # 38 tests
npm run test:watch    # vitest watch mode

llm-kb run ./test-folder
```

## Tutorial

Building this in public: [themindfulai.dev](https://themindfulai.dev/articles/building-karpathy-knowledge-base-part-1)

## License

MIT — [Satish Venkatakrishnan](https://deltaxy.ai)
