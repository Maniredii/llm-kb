import {
  createAgentSession,
  createBashTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { readdir, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getNodeModulesPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "node_modules");
    try { return candidate; } catch { dir = dirname(dir); }
  }
  return join(process.cwd(), "node_modules");
}

function buildQueryAgents(sourceFiles: string[], save: boolean): string {
  const sourceList = sourceFiles.map((f) => `  - ${f}`).join("\n");

  let content = `# llm-kb Knowledge Base — Query Mode

## How to answer questions

1. FIRST read .llm-kb/wiki/index.md to understand all available sources
2. Based on the question, select the most relevant source files (usually 2-5)
3. Read those source files in full from .llm-kb/wiki/sources/
4. Answer with inline citations: (filename, page number)
5. If the answer requires cross-referencing multiple files, read additional ones
6. If you can't find the answer, say so — don't hallucinate

## Available parsed sources
${sourceList}

## Non-PDF files
If the user's folder has Excel, Word, or PowerPoint files, these libraries are available:
- **exceljs** — for .xlsx/.xls files
- **mammoth** — for .docx files
- **officeparser** — for .pptx files
Write a quick Node.js script via bash to read them.

## Rules
- Always cite sources with filename and page number
- Read the FULL source file, not just the beginning
- Prefer primary sources over previous analyses
`;

  if (save) {
    content += `
## Research Mode
Save your analysis to .llm-kb/wiki/outputs/ with a descriptive filename (e.g., comparison-analysis.md).
Include the question at the top and all citations.
`;
  }

  return content;
}

export async function query(
  folder: string,
  question: string,
  options: { save?: boolean }
): Promise<void> {
  const sourcesDir = join(folder, ".llm-kb", "wiki", "sources");

  const files = await readdir(sourcesDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  if (mdFiles.length === 0) {
    throw new Error("No sources found. Run 'llm-kb run' first to parse documents.");
  }

  if (options.save) {
    await mkdir(join(folder, ".llm-kb", "wiki", "outputs"), { recursive: true });
  }

  process.env.NODE_PATH = getNodeModulesPath();

  const agentsContent = buildQueryAgents(mdFiles, !!options.save);

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
    tools.push(createBashTool(folder), createWriteTool(folder));
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

  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  await session.prompt(question);
  console.log();
  session.dispose();

  // Re-index after save so the compounding loop works
  if (options.save) {
    const { buildIndex } = await import("./indexer.js");
    await buildIndex(folder, sourcesDir);
  }
}
