import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTrace, saveTrace, appendToQueryLog, KBTrace } from "../src/trace-builder.js";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("trace-builder", () => {
  let tempDir: string;
  let sourcesDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "llm-kb-test-"));
    sourcesDir = join(tempDir, ".llm-kb", "wiki", "sources");
    await mkdir(sourcesDir, { recursive: true });
    // Create some source files
    await writeFile(join(sourcesDir, "doc1.md"), "# Doc 1");
    await writeFile(join(sourcesDir, "doc2.md"), "# Doc 2");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeSessionJsonl(entries: {
    header?: any;
    modelChange?: any;
    sessionInfo?: any;
    messages?: any[];
  }): string {
    const lines: string[] = [];
    const header = entries.header ?? {
      type: "session", version: 3, id: "test-session-id",
      timestamp: "2026-04-06T10:00:00Z", cwd: tempDir,
    };
    lines.push(JSON.stringify(header));

    if (entries.modelChange) lines.push(JSON.stringify(entries.modelChange));
    if (entries.sessionInfo) lines.push(JSON.stringify(entries.sessionInfo));
    for (const msg of entries.messages ?? []) lines.push(JSON.stringify(msg));

    return lines.join("\n");
  }

  describe("buildTrace", () => {
    it("returns null for incomplete sessions (no stop message)", async () => {
      const jsonl = makeSessionJsonl({
        messages: [
          {
            type: "message", id: "m1", parentId: null, timestamp: "2026-04-06T10:00:01Z",
            message: { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
          },
          {
            type: "message", id: "m2", parentId: "m1", timestamp: "2026-04-06T10:00:02Z",
            message: { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "toolUse", timestamp: 2 },
          },
        ],
      });
      const file = join(tempDir, "session.jsonl");
      await writeFile(file, jsonl);
      expect(await buildTrace(file, sourcesDir)).toBeNull();
    });

    it("parses a complete query session", async () => {
      const jsonl = makeSessionJsonl({
        modelChange: { type: "model_change", id: "mc1", parentId: null, timestamp: "2026-04-06T10:00:00Z", provider: "anthropic", modelId: "claude-sonnet-4-6" },
        sessionInfo: { type: "session_info", id: "si1", parentId: "mc1", timestamp: "2026-04-06T10:00:00Z", name: "query: What is doc1?" },
        messages: [
          {
            type: "message", id: "m1", parentId: "si1", timestamp: "2026-04-06T10:00:01Z",
            message: { role: "user", content: [{ type: "text", text: "What is doc1?" }], timestamp: 1000 },
          },
          {
            type: "message", id: "m2", parentId: "m1", timestamp: "2026-04-06T10:00:05Z",
            message: {
              role: "assistant",
              content: [
                { type: "toolCall", id: "tc1", name: "read", arguments: { path: ".llm-kb/wiki/sources/doc1.md" } },
                { type: "text", text: "Doc 1 is about X." },
              ],
              model: "claude-sonnet-4-6", stopReason: "stop", timestamp: 5000,
            },
          },
        ],
      });

      const file = join(tempDir, "session.jsonl");
      await writeFile(file, jsonl);
      const trace = await buildTrace(file, sourcesDir);

      expect(trace).not.toBeNull();
      expect(trace!.mode).toBe("query");
      expect(trace!.question).toBe("What is doc1?");
      expect(trace!.answer).toBe("Doc 1 is about X.");
      expect(trace!.model).toBe("claude-sonnet-4-6");
      expect(trace!.filesRead).toContain(".llm-kb/wiki/sources/doc1.md");
      expect(trace!.filesAvailable).toContain("doc1.md");
      expect(trace!.filesSkipped).toContain("doc2.md");
      expect(trace!.durationMs).toBe(4000);
    });

    it("identifies index sessions by session name", async () => {
      const jsonl = makeSessionJsonl({
        sessionInfo: { type: "session_info", id: "si1", parentId: null, timestamp: "2026-04-06T10:00:00Z", name: "index: 2026-04-06" },
        messages: [
          {
            type: "message", id: "m1", parentId: "si1", timestamp: "2026-04-06T10:00:01Z",
            message: { role: "user", content: "Build the index", timestamp: 1 },
          },
          {
            type: "message", id: "m2", parentId: "m1", timestamp: "2026-04-06T10:00:05Z",
            message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop", timestamp: 2 },
          },
        ],
      });

      const file = join(tempDir, "session.jsonl");
      await writeFile(file, jsonl);
      const trace = await buildTrace(file, sourcesDir);
      expect(trace!.mode).toBe("index");
    });

    it("returns null for files with fewer than 2 lines", async () => {
      const file = join(tempDir, "empty.jsonl");
      await writeFile(file, '{"type":"session"}\n');
      expect(await buildTrace(file, sourcesDir)).toBeNull();
    });
  });

  describe("saveTrace", () => {
    it("writes trace JSON to .llm-kb/traces/", async () => {
      const trace: KBTrace = {
        sessionId: "abc123",
        sessionFile: "session.jsonl",
        timestamp: "2026-04-06T10:00:00Z",
        mode: "query",
        question: "test?",
        answer: "yes",
        filesRead: [],
        filesAvailable: [],
        filesSkipped: [],
        model: "test-model",
      };

      await saveTrace(tempDir, trace);
      const path = join(tempDir, ".llm-kb", "traces", "abc123.json");
      expect(existsSync(path)).toBe(true);

      const saved = JSON.parse(await readFile(path, "utf-8"));
      expect(saved.sessionId).toBe("abc123");
      expect(saved.question).toBe("test?");
    });
  });

  describe("appendToQueryLog", () => {
    it("creates queries.md with header on first call", async () => {
      const trace: KBTrace = {
        sessionId: "abc",
        sessionFile: "s.jsonl",
        timestamp: "2026-04-06T10:00:00Z",
        mode: "query",
        question: "What is X?",
        answer: "X is Y.",
        filesRead: ["doc1.md"],
        filesAvailable: ["doc1.md"],
        filesSkipped: [],
        model: "test",
      };

      await appendToQueryLog(tempDir, trace);
      const logPath = join(tempDir, ".llm-kb", "wiki", "queries.md");
      expect(existsSync(logPath)).toBe(true);

      const content = await readFile(logPath, "utf-8");
      expect(content).toContain("# Query Log");
      expect(content).toContain("## What is X?");
      expect(content).toContain("X is Y.");
    });

    it("skips non-query traces", async () => {
      const trace: KBTrace = {
        sessionId: "abc",
        sessionFile: "s.jsonl",
        timestamp: "2026-04-06T10:00:00Z",
        mode: "index",
        filesRead: [],
        filesAvailable: [],
        filesSkipped: [],
      };

      await appendToQueryLog(tempDir, trace);
      const logPath = join(tempDir, ".llm-kb", "wiki", "queries.md");
      expect(existsSync(logPath)).toBe(false);
    });

    it("prepends new entries to existing log", async () => {
      const trace1: KBTrace = {
        sessionId: "a", sessionFile: "s.jsonl", timestamp: "2026-04-06T10:00:00Z",
        mode: "query", question: "First?", answer: "One", filesRead: [], filesAvailable: [], filesSkipped: [],
      };
      const trace2: KBTrace = {
        sessionId: "b", sessionFile: "s.jsonl", timestamp: "2026-04-06T11:00:00Z",
        mode: "query", question: "Second?", answer: "Two", filesRead: [], filesAvailable: [], filesSkipped: [],
      };

      await appendToQueryLog(tempDir, trace1);
      await appendToQueryLog(tempDir, trace2);

      const content = await readFile(join(tempDir, ".llm-kb", "wiki", "queries.md"), "utf-8");
      const firstIdx = content.indexOf("Second?");
      const secondIdx = content.indexOf("First?");
      expect(firstIdx).toBeLessThan(secondIdx); // newest first
    });
  });
});
