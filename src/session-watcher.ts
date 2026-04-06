import { watch } from "chokidar";
import { join, basename } from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { buildTrace, saveTrace, appendToQueryLog } from "./trace-builder.js";
import { updateWiki } from "./wiki-updater.js";
import chalk from "chalk";

const PROCESSED_LOG = ".llm-kb/traces/.processed"; // one session ID per line

/** Load the set of already-processed session IDs from disk */
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

/** Append a session ID to the persistent processed log */
async function markProcessed(kbRoot: string, sessionId: string): Promise<void> {
  const path = join(kbRoot, PROCESSED_LOG);
  await mkdir(join(kbRoot, ".llm-kb", "traces"), { recursive: true });
  await writeFile(path, sessionId + "\n", { flag: "a" });
}

export async function startSessionWatcher(kbRoot: string): Promise<void> {
  const sessionsDir = join(kbRoot, ".llm-kb", "sessions");
  const sourcesDir  = join(kbRoot, ".llm-kb", "wiki", "sources");

  // Persistent set — survives restarts
  const processed = await loadProcessed(kbRoot);

  // Debounce timers per file
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  // True while the initial catch-up scan is running — suppress log noise
  let startingUp = true;

  async function processSession(filePath: string): Promise<void> {
    const sessionId = basename(filePath, ".jsonl").split("_")[1] ?? basename(filePath, ".jsonl");
    if (processed.has(sessionId)) return;

    try {
      const trace = await buildTrace(filePath, sourcesDir);
      if (!trace) return; // session not complete yet

      // Mark processed in memory + on disk before doing the work
      // so a crash mid-way doesn't re-process on next start
      processed.add(trace.sessionId);
      await markProcessed(kbRoot, trace.sessionId);

      await saveTrace(kbRoot, trace);

      if (trace.mode === "query") {
        await appendToQueryLog(kbRoot, trace);
        await updateWiki(kbRoot, trace);

        // Only log after startup — don't spam on catch-up
        // silent — no user-facing log
      }
    } catch {
      // Non-fatal — session may still be in progress
    }
  }

  function scheduleProcess(filePath: string, delay = 1500): void {
    const existing = timers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(filePath);
      processSession(filePath);
    }, delay);
    timers.set(filePath, timer);
  }

  // Catch-up: process existing unprocessed sessions silently
  async function processExisting(): Promise<void> {
    if (!existsSync(sessionsDir)) { startingUp = false; return; }
    try {
      const files = (await readdir(sessionsDir)).filter((f) => f.endsWith(".jsonl"));
      for (const f of files) {
        await processSession(join(sessionsDir, f));
      }
    } catch { /* ignore */ }
    startingUp = false;
  }

  const watcher = watch(sessionsDir, {
    ignoreInitial: true,           // existing files handled by processExisting()
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    depth: 0,
  });

  watcher.on("add",    (p) => { if (p.endsWith(".jsonl")) scheduleProcess(p); });
  watcher.on("change", (p) => { if (p.endsWith(".jsonl")) scheduleProcess(p); });

  // Run catch-up silently in background
  processExisting();
}
