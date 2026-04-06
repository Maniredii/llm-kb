import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveKnowledgeBase } from "../src/resolve-kb.js";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveKnowledgeBase", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "llm-kb-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when no .llm-kb directory exists", () => {
    expect(resolveKnowledgeBase(tempDir)).toBeNull();
  });

  it("finds .llm-kb in the current directory", async () => {
    await mkdir(join(tempDir, ".llm-kb"), { recursive: true });
    expect(resolveKnowledgeBase(tempDir)).toBe(tempDir);
  });

  it("walks up to find .llm-kb in parent directory", async () => {
    const child = join(tempDir, "subdir", "deep");
    await mkdir(child, { recursive: true });
    await mkdir(join(tempDir, ".llm-kb"), { recursive: true });
    expect(resolveKnowledgeBase(child)).toBe(tempDir);
  });
});
