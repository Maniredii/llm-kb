import {
  createAgentSession,
  createBashTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  AuthStorage,
} from "@mariozechner/pi-coding-agent";
import { resolveModelCandidates } from "./model-resolver.js";
import { readdir, readFile } from "node:fs/promises";
import { createKBSession } from "./session-store.js";
import { getNodeModulesPath } from "./utils.js";
import { join } from "node:path";

function buildAgentsContent(sourcesDir: string, files: string[]): string {
  const sourceList = files
    .filter((f) => f.endsWith(".md"))
    .map((f) => `  - ${f}`)
    .join("\n");

  return `# llm-kb Knowledge Base

## How to access documents

### PDFs (pre-parsed)
PDFs have been parsed to markdown with bounding boxes.
Read the markdown versions in \`.llm-kb/wiki/sources/\` instead of the raw PDFs.

Available parsed sources:
${sourceList}

### Other file types (Excel, Word, PowerPoint)
You have bash and read tools. Use bash to run Node.js scripts.
Libraries are pre-installed via require().

For .docx (structured XML — ZIP containing word/document.xml):
  const AdmZip = require('adm-zip');
  const zip = new AdmZip('file.docx');
  const xml = zip.readAsText('word/document.xml');
  // Parse XML to extract headings and first paragraphs for summary

For .xlsx use exceljs:
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('file.xlsx');
  const sheet = wb.getWorksheet(1);

For .pptx use officeparser:
  const officeparser = require('officeparser');
  const text = await officeparser.parseOfficeAsync('file.pptx');

## Index file
Write the index to \`.llm-kb/wiki/index.md\`.

The index should be a markdown file with:
1. A title and last-updated timestamp
2. A summary table with columns: Source, Type, Pages/Size, Summary, Key Topics
3. Each source gets a one-line summary (read the first ~500 chars of each file to generate it)
4. Total word count across all sources
`;
}

export async function buildIndex(
  folder: string,
  sourcesDir: string,
  onOutput?: (text: string) => void,
  authStorage?: AuthStorage,
  modelId?: string
): Promise<string> {
  // List source files
  const files = await readdir(sourcesDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const jsonFiles = files.filter((f) => f.endsWith(".json") && !f.endsWith(".pages"));

  if (mdFiles.length === 0) {
    throw new Error("No source files found to index");
  }

  // Pre-read all file snippets in code (no LLM needed for this)
  const snippets: string[] = [];
  const total = mdFiles.length;
  const cols = process.stdout.columns || 80;

  for (let i = 0; i < mdFiles.length; i++) {
    const f = mdFiles[i];
    const pct = Math.round(((i + 1) / total) * 100);
    const name = f.length > 30 ? f.slice(0, 27) + "..." : f;
    process.stdout.write(`\r  Reading sources... ${i + 1}/${total} (${pct}%) ${name}`.padEnd(cols));

    try {
      const content = await readFile(join(sourcesDir, f), "utf-8");
      const preview = content.slice(0, 800);

      // Try to get page count from matching JSON
      const jsonName = f.replace(/\.md$/, ".json");
      let pages = 0;
      if (jsonFiles.includes(jsonName)) {
        try {
          // Read just the start of the JSON to get totalPages without parsing the whole file
          const jsonHead = await readFile(join(sourcesDir, jsonName), "utf-8", );
          const match = jsonHead.match(/"totalPages"\s*:\s*(\d+)/);
          if (match) pages = parseInt(match[1], 10);
        } catch {}
      }

      snippets.push(`### ${f}${pages > 0 ? ` (${pages} pages)` : ""}\n${preview}\n`);
    } catch {
      snippets.push(`### ${f}\n(could not read)\n`);
    }
  }
  process.stdout.write(`\r${"".padEnd(cols)}\r`);
  process.stdout.write(`  Read ${mdFiles.length} source previews\n`);

  // Split snippets into batches that fit in context (~100 files per batch)
  const BATCH_SIZE = 100;
  const batches: string[][] = [];
  for (let i = 0; i < snippets.length; i += BATCH_SIZE) {
    batches.push(snippets.slice(i, i + BATCH_SIZE));
  }

  // Build AGENTS.md content
  const agentsContent = buildAgentsContent(sourcesDir, files);

  // Set NODE_PATH so agent's bash scripts can use bundled libraries
  const nodeModulesPath = getNodeModulesPath();
  process.env.NODE_PATH = nodeModulesPath;

  const candidates = modelId
    ? await resolveModelCandidates(modelId, authStorage, "index")
    : [];

  if (modelId && candidates.length === 0) {
    throw new Error(`No usable model found for '${modelId}'. Configure Anthropic, OpenRouter, or OpenAI credentials.`);
  }

  const indexPath = join(sourcesDir, "..", "index.md");
  const attemptCandidates = candidates.length > 0
    ? candidates
    : [{ provider: "default", candidateId: "default", model: undefined as any }];

  // Process each batch with a separate LLM call
  const batchResults: string[] = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchLabel = batches.length > 1 ? ` (batch ${b + 1}/${batches.length})` : "";
    process.stdout.write(`  Generating index${batchLabel}...\n`);

    const batchContent = batch.join("\n---\n\n");
    const prompt = batches.length === 1
      ? `Here are previews of all ${mdFiles.length} source files in this knowledge base. Generate a summary table in markdown.

${batchContent}

Write .llm-kb/wiki/index.md with:
1. Title and last-updated timestamp
2. A markdown table with columns: Source, Type, Pages, Summary, Key Topics
3. One row per source with a one-line summary
4. Total count at the bottom

Do NOT read any files — all the data you need is above.`
      : b < batches.length - 1
      ? `Here are previews of source files ${b * BATCH_SIZE + 1}-${Math.min((b + 1) * BATCH_SIZE, mdFiles.length)} of ${mdFiles.length}. Generate summary table rows ONLY (no header, no footer).

${batchContent}

Output ONLY markdown table rows — one per source. Columns: Source, Type, Pages, Summary, Key Topics.
Do NOT read any files.`
      : `Here are the remaining source file previews (${b * BATCH_SIZE + 1}-${mdFiles.length} of ${mdFiles.length}).

${batchContent}

Output ONLY markdown table rows for these sources. Columns: Source, Type, Pages, Summary, Key Topics.

Then combine with the previous batch results below and write the final .llm-kb/wiki/index.md:

Previous batch rows:
${batchResults.join("\n")}

Write the complete index.md with title, timestamp, full table (header + all rows), and total count.`;

    let lastError: unknown;

    for (let i = 0; i < attemptCandidates.length; i++) {
      const candidate = attemptCandidates[i]!;

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

      const { session } = await createAgentSession({
        cwd: folder,
        resourceLoader: loader,
        tools: [
          createReadTool(folder),
          createBashTool(folder),
          createWriteTool(folder),
        ],
        sessionManager: await createKBSession(folder),
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false },
        }),
        ...(authStorage ? { authStorage } : {}),
        ...(candidate.model ? { model: candidate.model } : {}),
      });

      if (onOutput) {
        session.subscribe((event) => {
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta"
          ) {
            onOutput(event.assistantMessageEvent.delta);
          }
        });
      }

      session.setSessionName(`index: ${new Date().toISOString()}`);

      try {
        await session.prompt(prompt);

        if (batches.length === 1 || b === batches.length - 1) {
          // Final or only batch — index.md should be written
          const content = await readFile(indexPath, "utf-8");
          session.dispose();
          return content;
        } else {
          // Intermediate batch — capture the text output for merging
          const messages = session.state.messages as any[];
          const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
          const text = lastAssistant?.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") ?? "";
          batchResults.push(text);
          session.dispose();
          break; // Success — move to next batch
        }
      } catch (error) {
        lastError = error;
        session.dispose();
        const next = attemptCandidates[i + 1];
        if (next) {
          const detail = error instanceof Error ? error.message : String(error);
          console.warn(`  Index attempt failed on ${candidate.provider}:${candidate.model?.id ?? candidate.candidateId} (${detail}). Retrying with ${next.provider}:${next.model?.id ?? next.candidateId}...`);
          continue;
        }
        if (lastError instanceof Error) throw lastError;
        throw new Error("Agent did not create index.md");
      }
    }
  }

  throw new Error("Agent did not create index.md");
}
