import { watch } from "chokidar";
import { join, basename } from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { buildTrace, saveTrace, appendToQueryLog } from "./trace-builder.js";
import { updateWiki } from "./wiki-updater.js";

const PROCESSED_LOG = ".llm-kb/traces/.processed";

async function loadProcessed(kbRoot: string): Promise<Set<string>> {
  const path = join(kbRoot, PROCESSED_LOG);
  if (!existsSync(path)) return new Set();
  try {
    const lines = (await readFile(path, "utf-8")).split("\n").filter(Boolean);
    return new Set(lines);
  } catch {
    return new Set();
  }
}

async function markProcessed(kbRoot: string, sessionId: string): Promise<void> {
  const path = join(kbRoot, PROCESSED_LOG);
  await mkdir(join(kbRoot, ".llm-kb", "traces"), { recursive: true });
  await writeFile(path, sessionId + "\n", { flag: "a" });
}

/**
 * Watch .llm-kb/sessions/ for completed session files.
 * Processes them silently — saves traces, updates wiki, logs queries.
 * Persists processed IDs to .llm-kb/traces/.processed to survive restarts.
 */
export async function startSessionWatcher(kbRoot: string): Promise<void> {
  const sessionsDir = join(kbRoot, ".llm-kb", "sessions");
  const sourcesDir  = join(kbRoot, ".llm-kb", "wiki", "sources");

  const processed = await loadProcessed(kbRoot);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  async function processSession(filePath: string): Promise<void> {
    const sessionId = basename(filePath, ".jsonl").split("_")[1] ?? basename(filePath, ".jsonl");
    if (processed.has(sessionId)) return;

    try {
      const trace = await buildTrace(filePath, sourcesDir);
      if (!trace) return;

      processed.add(trace.sessionId);
      await markProcessed(kbRoot, trace.sessionId);

      await saveTrace(kbRoot, trace);

      if (trace.mode === "query") {
        await appendToQueryLog(kbRoot, trace);
        await updateWiki(kbRoot, trace);
      }
    } catch {
      // Non-fatal — session may still be in progress
    }
  }

  function scheduleProcess(filePath: string): void {
    const existing = timers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(filePath);
      processSession(filePath);
    }, 1500);
    timers.set(filePath, timer);
  }

  // Catch-up: process existing unprocessed sessions silently
  if (existsSync(sessionsDir)) {
    try {
      const files = (await readdir(sessionsDir)).filter((f) => f.endsWith(".jsonl"));
      for (const f of files) {
        await processSession(join(sessionsDir, f));
      }
    } catch { /* ignore */ }
  }

  const watcher = watch(sessionsDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    depth: 0,
  });

  watcher.on("add",    (p) => { if (p.endsWith(".jsonl")) scheduleProcess(p); });
  watcher.on("change", (p) => { if (p.endsWith(".jsonl")) scheduleProcess(p); });
}
