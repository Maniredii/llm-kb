import {
  createAgentSession,
  createBashTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  SettingsManager,
  AuthStorage,
} from "@mariozechner/pi-coding-agent";
import { getModels } from "@mariozechner/pi-ai";
import { readdir, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createKBSession } from "./session-store.js";
import { saveTrace, appendToQueryLog, KBTrace } from "./trace-builder.js";
import { updateWiki } from "./wiki-updater.js";
import { join, dirname, basename } from "node:path";
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

function buildQueryAgents(sourceFiles: string[], save: boolean, wikiContent: string): string {
  const sourceList = sourceFiles.map((f) => `  - ${f}`).join("\n");

  const wikiSection = wikiContent
    ? `## Knowledge Wiki (use this first)

The wiki below contains knowledge already extracted from this knowledge base.
If the user's question is covered here, answer directly from it — no need to re-read source files.
Always cite the original source files mentioned in the wiki.

${wikiContent}

---

`
    : "";

  const sourceStep = wikiContent ? "If not covered in the wiki above: read the sources" : "How to answer";

  let content = `# llm-kb Knowledge Base — Query Mode

${wikiSection}## ${sourceStep}

1. Read .llm-kb/wiki/index.md to understand all available sources
2. Select the most relevant source files (usually 2-5) and read them in full
3. Answer with inline citations: (filename, page number)
4. If you can't find the answer, say so — don't hallucinate

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

/** Extract plain text from an assistant message content array */
function extractAnswerText(content: any[]): string {
  return (content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text ?? "")
    .join("")
    .trim();
}

/** Return a display label for a tool execution, or null to suppress it */
function getToolLabel(toolName: string, args: any): string | null {
  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    const file = basename((args?.path as string) ?? "");
    // Skip if no real file extension (e.g. directory paths like "2. My folder")
    if (!file || !/\.[a-z0-9]{1,6}$/i.test(file)) return null;
    const verb = toolName === "read" ? "Reading" : toolName === "write" ? "Writing" : "Editing";
    return `${verb}  ${file}`;
  }
  if (toolName === "bash" && args?.command) {
    const cmd = (args.command as string).trim().split("\n")[0].slice(0, 60);
    return `Running  ${cmd}`;
  }
  return null; // suppress run_experiment and other internal tools
}

/** Extract all file paths from read tool calls across all messages */
function extractFilesRead(messages: any[]): string[] {
  const paths: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const block of msg.content ?? []) {
      if (block.type === "toolCall" && block.name === "read") {
        const p: string = block.arguments?.path ?? "";
        if (p && !paths.includes(p)) paths.push(p);
      }
    }
  }
  return paths;
}

/**
 * Schedules wiki updates triggered by Pi session events.
 *
 * Fires on:
 * - message_end  when stopReason === "stop" (a real answer, not a mid-tool-call turn)
 *   → throttled: only if N stop-messages have accumulated OR M minutes have elapsed
 * - agent_end    always — final flush regardless of counters
 *
 * Updates are chained (serial) so concurrent writes never race.
 */
class WikiUpdateScheduler {
  private stopMsgCount = 0;
  private lastUpdateAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly everyNMessages: number,
    private readonly everyMinutes: number
  ) {}

  private shouldUpdate(): boolean {
    const countTrigger = this.stopMsgCount > 0 && this.stopMsgCount % this.everyNMessages === 0;
    const timeTrigger =
      this.lastUpdateAt > 0 &&
      Date.now() - this.lastUpdateAt > this.everyMinutes * 60_000;
    return countTrigger || timeTrigger;
  }

  private enqueue(work: () => Promise<void>) {
    this.chain = this.chain.then(() => work().catch(() => {}));
  }

  /** Call on every message_end event */
  onMessageEnd(message: any, getSnapshot: () => { messages: any[] }, doUpdate: (msgs: any[]) => Promise<void>) {
    if (message.role !== "assistant" || message.stopReason !== "stop") return;
    this.stopMsgCount++;
    if (this.shouldUpdate()) {
      this.lastUpdateAt = Date.now();
      const { messages } = getSnapshot();
      this.enqueue(() => doUpdate(messages));
    }
  }

  /** Call on agent_end — always flushes */
  onAgentEnd(messages: any[], doUpdate: (msgs: any[]) => Promise<void>) {
    this.lastUpdateAt = Date.now();
    this.enqueue(() => doUpdate(messages));
  }

  /** Await all queued updates */
  flush(): Promise<void> {
    return this.chain;
  }
}

export async function query(
  folder: string,
  question: string,
  options: { save?: boolean; authStorage?: AuthStorage; modelId?: string }
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

  const wikiPath = join(folder, ".llm-kb", "wiki", "wiki.md");
  const wikiContent = existsSync(wikiPath)
    ? await readFile(wikiPath, "utf-8").catch(() => "")
    : "";

  const agentsContent = buildQueryAgents(mdFiles, !!options.save, wikiContent);

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

  const model = options.modelId
    ? getModels("anthropic").find((m) => m.id === options.modelId)
    : undefined;

  const { session } = await createAgentSession({
    cwd: folder,
    resourceLoader: loader,
    tools,
    sessionManager: await createKBSession(folder),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
    }),
    thinkingLevel: "low", // show thinking; "low" is fast and lightweight
    ...(options.authStorage ? { authStorage: options.authStorage } : {}),
    ...(model ? { model } : {}),
  });

  session.setSessionName(`query: ${question}`);

  // Every 5 stop-messages OR every 3 minutes — whichever comes first
  const scheduler = new WikiUpdateScheduler(5, 3);

  const buildTraceFromMessages = (messages: any[]): KBTrace | null => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.stopReason === "stop");
    if (!lastAssistant) return null;

    const answer = extractAnswerText(lastAssistant.content);
    const filesRead = extractFilesRead(messages);
    const filesSkipped = mdFiles.filter((f) => !filesRead.some((r) => r.endsWith(f)));

    return {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile ?? "",
      timestamp: new Date().toISOString(),
      mode: "query",
      question,
      answer,
      filesRead,
      filesAvailable: mdFiles,
      filesSkipped,
      model: lastAssistant.model,
    };
  };

  const doUpdate = async (messages: any[]) => {
    const trace = buildTraceFromMessages(messages);
    if (!trace) return;
    await saveTrace(folder, trace);
    await appendToQueryLog(folder, trace);
    await updateWiki(folder, trace, options.authStorage);
  };

  let hadToolOutput = false;
  let outputStarted = false; // any output has begun (dot, thinking, tools, text)

  session.subscribe((event) => {

    // ── Immediate dot on first turn ───────────────────────────────────
    // Stays visible on its own line — no ’r tricks, no clearing.
    if (event.type === "turn_start" && !outputStarted) {
      if (process.stdout.isTTY) process.stdout.write(chalk.dim("  ●\n"));
      outputStarted = true;
    }

    // ── Tool call decided (model side) + tool execution (actual run) ───────
    if (event.type === "message_update") {
      const ae = event.assistantMessageEvent as any;

      // toolcall_end fires when the model finishes writing the tool call JSON.
      // Show a dim line immediately — before the tool actually runs.
      if (ae.type === "toolcall_end" && ae.toolCall) {
        const label = getToolLabel(ae.toolCall.name, ae.toolCall.arguments);
        if (label) {
          const line = process.stdout.isTTY ? chalk.dim(`  ${label}`) : `  ${label}`;
          process.stdout.write(`\n${line}\n`);
          hadToolOutput = true;
        }
      }
    }

    if (event.type === "tool_execution_start") {
      // tool_execution_start fires when the tool actually begins running.
      // Only show if we didn’t already show it from toolcall_end above.
      if (!hadToolOutput) {
        const { toolName, args } = event as any;
        const label = getToolLabel(toolName, args);
        if (label) {
          const line = process.stdout.isTTY ? chalk.dim(`  ${label}`) : `  ${label}`;
          process.stdout.write(`\n${line}\n`);
          hadToolOutput = true;
        }
      }
    }

    // ── Thinking + answer text ────────────────────────────────────────────
    if (event.type === "message_update") {
      const ae = event.assistantMessageEvent;

      if (ae.type === "thinking_start") {
        process.stdout.write("\n"); // blank line after the ● dot
      }

      if (ae.type === "thinking_delta") {
        const chunk = process.stdout.isTTY ? chalk.dim(ae.delta) : ae.delta;
        process.stdout.write(chunk);
      }

      if (ae.type === "thinking_end") {
        process.stdout.write("\n\n"); // blank line before answer
        hadToolOutput = false;
      }

      if (ae.type === "text_start" && hadToolOutput) {
        process.stdout.write("\n"); // blank line between last tool line and answer
        hadToolOutput = false;
      }

      if (ae.type === "text_delta") {
        process.stdout.write(ae.delta);
      }
    }

    // ── Wiki update throttle ──────────────────────────────────────────────
    if (event.type === "message_end") {
      scheduler.onMessageEnd(
        event.message,
        () => ({ messages: session.state.messages as any[] }),
        doUpdate
      );
    }

    if (event.type === "agent_end") {
      scheduler.onAgentEnd(event.messages as any[], doUpdate);
    }
  });

  await session.prompt(question);
  console.log();

  // Wait for all scheduled wiki updates to complete before disposing
  await scheduler.flush();
  session.dispose();

  // Re-index after save so the compounding loop works
  if (options.save) {
    const { buildIndex } = await import("./indexer.js");
    await buildIndex(folder, sourcesDir, undefined, options.authStorage);
  }
}
