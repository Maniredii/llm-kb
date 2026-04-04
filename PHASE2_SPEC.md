# llm-kb — Phase 2: Query Engine

> **Goal:** `llm-kb query "question" --folder ./research` works from the terminal.
> **Depends on:** Phase 1 (ingest pipeline — complete)
> **Blog:** Part 3 of the series

---

## What Success Looks Like

```bash
llm-kb query "what are the reserve requirements?" --folder ./research
```

```
Reading index... 12 sources
Selected: reserve-policy.md, q3-results.md, board-deck.md
Reading 3 files...

Reserve requirements are defined in two documents:

1. **Reserve Policy** (reserve-policy.md, p.3): Minimum reserve
   ratio of 12% of total assets, reviewed quarterly.

2. **Q3 Results** (q3-results.md, p.8): Current reserve ratio
   is 14.2%, above the 12% minimum. Management notes this
   provides a 2.2% buffer against regulatory changes.

Sources: reserve-policy.md (p.3), q3-results.md (p.8)
```

That's the shape: file selection visible, citations inline, synthesis across sources.

---

## Two Modes

### Query (read-only)

```bash
llm-kb query "what changed in Q4 guidance?" --folder ./research
```

The agent reads `index.md`, picks files, reads them, answers. **Cannot modify anything.** Tools: `createReadTool` only.

### Research (read + write)

```bash
llm-kb query "compare pipeline coverage to revenue target" --folder ./research --save
```

Same as query, but the answer is also saved to `.llm-kb/wiki/outputs/`. The watcher detects the new file and re-indexes. Next query can reference the analysis.

Tools: `createReadTool` + `createWriteTool` + `createBashTool`.

The `--save` flag switches from query mode to research mode.

---

## Architecture

Same pattern as the indexer — a Pi SDK session with different tools:

```typescript
export async function query(
  folder: string,
  question: string,
  options: { save?: boolean }
) {
  const sourcesDir = join(folder, ".llm-kb", "wiki", "sources");
  const outputsDir = join(folder, ".llm-kb", "wiki", "outputs");

  // Build AGENTS.md for query context
  const agentsContent = buildQueryAgents(sourcesDir, options.save);

  const loader = new DefaultResourceLoader({
    cwd: folder,
    agentsFilesOverride: (current) => ({
      agentsFiles: [
        ...current.agentsFiles,
        { path: ".llm-kb/AGENTS.md", content: agentsContent },
      ],
    }),
  });
  await loader.reload();

  const tools = [createReadTool(folder)];
  if (options.save) {
    tools.push(createWriteTool(folder), createBashTool(folder));
  }

  const { session } = await createAgentSession({
    cwd: folder,
    resourceLoader: loader,
    tools,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
    }),
  });

  // Stream output to terminal
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  await session.prompt(question);
  session.dispose();
}
```

### The Query AGENTS.md

The injected `AGENTS.md` for query mode tells the agent:

```markdown
# llm-kb Knowledge Base — Query Mode

## How to answer questions

1. FIRST read .llm-kb/wiki/index.md to see all available sources
2. Based on the question, select the most relevant source files
3. Read those files in full (not just the first 500 chars)
4. Answer with inline citations: (filename, page/section)
5. If the answer requires cross-referencing, read additional files
6. Prefer primary sources over previous analyses in outputs/

## Available sources
(dynamically generated list of .md files in sources/)

## Available libraries for non-PDF files
- exceljs — for .xlsx/.xls
- mammoth — for .docx
- officeparser — for .pptx
Write a quick Node.js script via bash to read these when needed.

## Rules
- Always cite sources with filename and page number
- If you can't find the answer, say so — don't hallucinate
- Read the FULL file, not just the beginning
```

For research mode, add:

```markdown
## Research Mode
You can save your analysis to .llm-kb/wiki/outputs/.
Use a descriptive filename (e.g., coverage-analysis.md).
The file watcher will detect it and update the index.
```

---

## CLI Integration

Add `query` command to Commander:

```typescript
program
  .command("query")
  .description("Ask a question across your knowledge base")
  .argument("<question>", "Your question")
  .option("--folder <path>", "Path to document folder", ".")
  .option("--save", "Save the answer to wiki/outputs/ (research mode)")
  .action(async (question, options) => {
    const folder = resolve(options.folder);

    // Check if .llm-kb exists
    if (!existsSync(join(folder, ".llm-kb"))) {
      console.error(chalk.red("No knowledge base found. Run 'llm-kb run' first."));
      process.exit(1);
    }

    await query(folder, question, { save: options.save });
  });
```

---

## Trace Logging (Prep for Eval — Phase 4)

Every query gets logged to `.llm-kb/traces/`:

```json
{
  "timestamp": "2026-04-05T14:30:00Z",
  "question": "what are the reserve requirements?",
  "mode": "query",
  "filesRead": ["index.md", "reserve-policy.md", "q3-results.md"],
  "filesAvailable": ["reserve-policy.md", "q3-results.md", "board-deck.md", "pipeline.md"],
  "answer": "Reserve requirements are defined in two documents...",
  "citations": [
    { "file": "reserve-policy.md", "location": "p.3", "claim": "Minimum reserve ratio of 12%" },
    { "file": "q3-results.md", "location": "p.8", "claim": "Current reserve ratio is 14.2%" }
  ],
  "tokensUsed": 3800,
  "durationMs": 4200,
  "model": "claude-sonnet-4"
}
```

Implementation: wrap the session to intercept tool calls and capture which files were read. Save trace JSON after session completes.

The eval agent (Phase 4) reads these traces to check citations against sources.

---

## Streaming Output

Terminal query should stream — the user sees the answer appear word by word, not wait for the full response. The `session.subscribe()` handler writes deltas to stdout.

For the `run` command (when we add query to the web UI in Phase 3), streaming goes through the Vercel AI SDK protocol.

---

## Constraints

1. **Query must work without the web server running.** `llm-kb query` is standalone — it reads `.llm-kb/` directly. No dependency on `llm-kb run`.

2. **Read-only by default.** Query mode cannot modify files. Only `--save` enables write.

3. **Index must exist.** If `.llm-kb/wiki/index.md` doesn't exist, error out: "No knowledge base found. Run 'llm-kb run' first."

4. **Graceful on empty results.** If the agent can't find relevant files, it should say "I couldn't find sources relevant to this question" — not hallucinate.

5. **Token-conscious.** The agent reads index.md (~200 tokens for 50 sources) first, then only the files it selects (3-7 typically). Don't read all sources.

---

## Build Order (Slices)

| Slice | What | Demoable? |
|---|---|---|
| 1 | `query` command + read-only session + streaming | ✅ Ask questions, get answers |
| 2 | `--save` flag + research mode + write to outputs/ | ✅ Answers compound in wiki |
| 3 | Trace logging (JSON per query) | Prep for eval |
| 4 | `status` command (show KB stats) | ✅ Nice-to-have |

---

## Definition of Done

- [ ] `llm-kb query "question" --folder ./research` returns a cited answer
- [ ] Answer streams to terminal (word by word, not all at once)
- [ ] Agent reads index.md first, then selects and reads relevant source files
- [ ] `--save` flag saves the answer to `.llm-kb/wiki/outputs/`
- [ ] Saved answers get detected by watcher and re-indexed
- [ ] Query traces logged to `.llm-kb/traces/` as JSON
- [ ] Error if no `.llm-kb/` exists ("run 'llm-kb run' first")
- [ ] Non-PDF files (Excel, Word) readable by agent via bundled libraries
- [ ] Blog Part 3 written with real terminal output

---

## What This Enables

With query working, the demo becomes:

```bash
npx llm-kb run ./my-documents    # ingest
llm-kb query "what changed?"     # ask
llm-kb query "compare X vs Y" --save  # research (compounds)
```

Three commands. Ingest → Query → Research. That's a product, not a script.

---

*Phase 2 spec written April 4, 2026. DeltaXY.*
