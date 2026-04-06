import {
  createAgentSession,
  createBashTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  SettingsManager,
  AuthStorage,
} from "@mariozechner/pi-coding-agent";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { getModels } from "@mariozechner/pi-ai";
import { readdir, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createKBSession, continueKBSession } from "./session-store.js";
import { saveTrace, appendToQueryLog, KBTrace } from "./trace-builder.js";
import { updateWiki } from "./wiki-updater.js";
import { join, basename } from "node:path";
import chalk from "chalk";
import { getNodeModulesPath } from "./utils.js";
import { MarkdownStream } from "./md-stream.js";
import type { ChatDisplay } from "./tui-display.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractAnswerText(content: any[]): string {
  return (content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text ?? "")
    .join("")
    .trim();
}

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

function getToolLabel(toolName: string, args: any): string | null {
  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    const file = basename((args?.path as string) ?? "");
    if (!file || !/\.[a-z0-9]{1,6}$/i.test(file)) return null;
    const verb = toolName === "read" ? "Reading" : toolName === "write" ? "Writing" : "Editing";
    return `${verb}  ${file}`;
  }
  if (toolName === "bash" && args?.command) {
    return `Running  ${(args.command as string).trim().split("\n")[0].slice(0, 60)}`;
  }
  return null;
}

// ── AGENTS.md ───────────────────────────────────────────────────────────────

function buildQueryAgents(sourceFiles: string[], save: boolean, wikiContent: string): string {
  const sourceList = sourceFiles.map((f) => `  - ${f}`).join("\n");
  const wikiSection = wikiContent
    ? `## Knowledge Wiki (use this first)\n\nThe wiki below contains knowledge already extracted from this knowledge base.\nIf the user's question is covered here, answer directly from it — no need to re-read source files.\nAlways cite the original source files mentioned in the wiki.\n\n${wikiContent}\n\n---\n\n`
    : "";
  const sourceStep = wikiContent ? "If not covered in the wiki above: read the sources" : "How to answer";

  let content = `# llm-kb Knowledge Base — Query Mode\n\n${wikiSection}## ${sourceStep}\n\n1. Read .llm-kb/wiki/index.md to understand all available sources\n2. Select the most relevant source files (usually 2-5) and read them in full\n3. Answer with inline citations: (filename, page number)\n4. If you can't find the answer, say so — don't hallucinate\n\n## Available parsed sources\n${sourceList}\n\n## Non-PDF files\nIf the user's folder has Excel, Word, or PowerPoint files, these libraries are available:\n- **exceljs** — for .xlsx/.xls files\n- **mammoth** — for .docx files\n- **officeparser** — for .pptx files\nWrite a quick Node.js script via bash to read them.\n\n## Rules\n- Always cite sources with filename and page number\n- Read the FULL source file, not just the beginning\n- Prefer primary sources over previous analyses\n`;
  if (save) content += `\n## Research Mode\nSave your analysis to .llm-kb/wiki/outputs/ with a descriptive filename.\nInclude the question at the top and all citations.\n`;
  return content;
}

// ── Wiki update scheduler ───────────────────────────────────────────────────

class WikiUpdateScheduler {
  private stopMsgCount = 0;
  private lastUpdateAt = 0;
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly everyN: number, private readonly everyMin: number) {}
  private shouldUpdate() {
    return (this.stopMsgCount > 0 && this.stopMsgCount % this.everyN === 0) ||
      (this.lastUpdateAt > 0 && Date.now() - this.lastUpdateAt > this.everyMin * 60_000);
  }
  private enqueue(work: () => Promise<void>) { this.chain = this.chain.then(() => work().catch(() => {})); }
  onMessageEnd(msg: any, snap: () => { messages: any[] }, doUpdate: (m: any[]) => Promise<void>) {
    if (msg.role !== "assistant" || msg.stopReason !== "stop") return;
    this.stopMsgCount++;
    if (this.shouldUpdate()) { this.lastUpdateAt = Date.now(); this.enqueue(() => doUpdate(snap().messages)); }
  }
  onAgentEnd(msgs: any[], doUpdate: (m: any[]) => Promise<void>) {
    this.lastUpdateAt = Date.now(); this.enqueue(() => doUpdate(msgs));
  }
  flush() { return this.chain; }
}

// ── Display subscriber ──────────────────────────────────────────────────────
// Routes events to either TUI components (interactive) or stdout (one-shot)

function subscribeDisplay(
  session: AgentSession,
  opts: {
    modelId?: string;
    authStorage?: AuthStorage;
    folder: string;
    mdFiles: string[];
    tuiDisplay?: ChatDisplay;
  }
) {
  const ui = opts.tuiDisplay;
  const dim = (s: string) => process.stdout.isTTY ? chalk.dim(s) : s;
  const thinLine = () => dim("\u2500".repeat(process.stdout.columns || 80));

  let phase: "idle" | "thinking" | "tools" | "answer" = "idle";
  let filesReadCount = 0;
  let shownToolCalls = new Set<string>();
  let startTime = Date.now();
  let md = new MarkdownStream(process.stdout.isTTY ?? false);
  let lastQuestion = "";

  const scheduler = new WikiUpdateScheduler(5, 3);

  const buildTrace = (messages: any[]): KBTrace | null => {
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.stopReason === "stop");
    if (!last) return null;
    const filesRead = extractFilesRead(messages);
    return {
      sessionId: session.sessionId, sessionFile: session.sessionFile ?? "",
      timestamp: new Date().toISOString(), mode: "query", question: lastQuestion,
      answer: extractAnswerText(last.content), filesRead,
      filesAvailable: opts.mdFiles,
      filesSkipped: opts.mdFiles.filter((f) => !filesRead.some((r) => r.endsWith(f))),
      model: last.model,
    };
  };

  const doUpdate = async (messages: any[]) => {
    const trace = buildTrace(messages);
    if (!trace) return;
    await saveTrace(opts.folder, trace);
    await appendToQueryLog(opts.folder, trace);
    await updateWiki(opts.folder, trace, opts.authStorage);
  };

  session.subscribe((event) => {

    // ── Reset ────────────────────────────────────────────────────────────
    if (event.type === "agent_start") {
      phase = "idle";
      filesReadCount = 0;
      shownToolCalls = new Set();
      startTime = Date.now();
      md = new MarkdownStream(process.stdout.isTTY ?? false);
      const modelName = opts.modelId ?? "claude-sonnet-4-6";
      if (ui) { ui.disableInput(); ui.beginResponse(modelName); }
      else process.stdout.write(dim(`\u27e1 ${modelName}`) + "\n");
    }

    // ── Thinking ─────────────────────────────────────────────────────────
    if (event.type === "message_update") {
      const ae = event.assistantMessageEvent;
      if (ae.type === "thinking_start") {
        if (!ui) process.stdout.write(dim("\n\u25b8 Thinking\n"));
        phase = "thinking";
      }
      if (ae.type === "thinking_delta") {
        if (ui) ui.appendThinking(ae.delta);
        else process.stdout.write(dim(`  ${ae.delta}`));
      }
      if (ae.type === "thinking_end") {
        if (ui) ui.endThinking();
        else process.stdout.write("\n");
      }
    }

    // ── Tool calls ───────────────────────────────────────────────────────
    if (event.type === "message_update") {
      const ae = event.assistantMessageEvent as any;
      if (ae.type === "toolcall_end" && ae.toolCall) {
        const label = getToolLabel(ae.toolCall.name, ae.toolCall.arguments);
        if (label) {
          if (!ui && phase !== "tools") process.stdout.write("\n");
          phase = "tools";
          if (ui) ui.addToolCall(ae.toolCall.id, label, ae.toolCall.name);
          else {
            process.stdout.write(dim(`  \u25b8 ${label}`) + "\n");
            shownToolCalls.add(ae.toolCall.id);
            if (ae.toolCall.name === "read") filesReadCount++;
          }
        }
      }
    }

    if (event.type === "tool_execution_start") {
      const { toolCallId, toolName, args } = event as any;
      if (ui) {
        const label = getToolLabel(toolName, args);
        if (label) ui.addToolCall(toolCallId, label, toolName);
      } else if (!shownToolCalls.has(toolCallId)) {
        const label = getToolLabel(toolName, args);
        if (label) {
          if (phase !== "tools") process.stdout.write("\n");
          phase = "tools";
          process.stdout.write(dim(`  \u25b8 ${label}`) + "\n");
          shownToolCalls.add(toolCallId);
          if (toolName === "read") filesReadCount++;
        }
      }
    }

    // ── Answer ───────────────────────────────────────────────────────────
    if (event.type === "message_update") {
      const ae = event.assistantMessageEvent;
      if (ae.type === "text_start" && phase !== "answer") {
        if (ui) ui.beginAnswer();
        else if (phase === "thinking" || phase === "tools") {
          process.stdout.write(`\n${thinLine()}\n\n`);
        }
        phase = "answer";
      }
      if (ae.type === "text_delta") {
        if (ui) ui.appendAnswer(ae.delta);
        else process.stdout.write(md.push(ae.delta));
      }
      if (ae.type === "text_end" && !ui) process.stdout.write(md.end());
    }

    // ── Completion ───────────────────────────────────────────────────────
    if (event.type === "agent_end") {
      if (ui) { ui.showCompletion(); ui.enableInput(); }
      else {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const source = filesReadCount > 0
          ? `${filesReadCount} file${filesReadCount !== 1 ? "s" : ""} read` : "wiki";
        const stats = `${elapsed}s \u00b7 ${source}`;
        const cols = process.stdout.columns || 80;
        const pad = Math.max(0, cols - stats.length - 4);
        process.stdout.write(`\n\n${dim("\u2500\u2500 " + stats + " " + "\u2500".repeat(pad))}\n`);
      }
      scheduler.onAgentEnd(event.messages as any[], doUpdate);
    }

    // ── Wiki throttle ────────────────────────────────────────────────────
    if (event.type === "message_end") {
      scheduler.onMessageEnd(event.message, () => ({ messages: session.state.messages as any[] }), doUpdate);
    }
  });

  return {
    setQuestion(q: string) { lastQuestion = q; },
    flush() { return scheduler.flush(); },
  };
}

// ── Session factory ─────────────────────────────────────────────────────────

export interface ChatSession {
  session: AgentSession;
  display: ReturnType<typeof subscribeDisplay>;
}

export async function createChat(
  folder: string,
  options: { save?: boolean; authStorage?: AuthStorage; modelId?: string; tuiDisplay?: ChatDisplay }
): Promise<ChatSession> {
  const sourcesDir = join(folder, ".llm-kb", "wiki", "sources");
  const files = await readdir(sourcesDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) throw new Error("No sources found. Run 'llm-kb run' first.");
  if (options.save) await mkdir(join(folder, ".llm-kb", "wiki", "outputs"), { recursive: true });

  process.env.NODE_PATH = getNodeModulesPath();

  const wikiPath = join(folder, ".llm-kb", "wiki", "wiki.md");
  const wikiContent = existsSync(wikiPath) ? await readFile(wikiPath, "utf-8").catch(() => "") : "";
  const agentsContent = buildQueryAgents(mdFiles, !!options.save, wikiContent);

  const loader = new DefaultResourceLoader({
    cwd: folder,
    agentsFilesOverride: (current) => ({
      agentsFiles: [...current.agentsFiles, { path: ".llm-kb/AGENTS.md", content: agentsContent }],
    }),
  });
  await loader.reload();

  const tools = [createReadTool(folder)];
  if (options.save) tools.push(createBashTool(folder), createWriteTool(folder));

  const model = options.modelId ? getModels("anthropic").find((m) => m.id === options.modelId) : undefined;

  const { session } = await createAgentSession({
    cwd: folder,
    resourceLoader: loader,
    tools,
    sessionManager: options.save ? await createKBSession(folder) : await continueKBSession(folder),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    thinkingLevel: "low",
    ...(options.authStorage ? { authStorage: options.authStorage } : {}),
    ...(model ? { model } : {}),
  });

  const display = subscribeDisplay(session, {
    modelId: options.modelId, authStorage: options.authStorage,
    folder, mdFiles, tuiDisplay: options.tuiDisplay,
  });

  return { session, display };
}

// ── One-shot query (stdout mode, for `llm-kb query` command) ────────────────

export async function query(
  folder: string,
  question: string,
  options: { save?: boolean; authStorage?: AuthStorage; modelId?: string }
): Promise<void> {
  const { session, display } = await createChat(folder, options);
  session.setSessionName(`query: ${question}`);
  display.setQuestion(question);
  await session.prompt(question);
  await display.flush();
  session.dispose();
  if (options.save) {
    const sourcesDir = join(folder, ".llm-kb", "wiki", "sources");
    const { buildIndex } = await import("./indexer.js");
    await buildIndex(folder, sourcesDir, undefined, options.authStorage);
  }
}
