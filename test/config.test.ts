import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, ensureConfig, DEFAULT_INDEX_MODEL, DEFAULT_QUERY_MODEL } from "../src/config.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "llm-kb-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("loadConfig", () => {
    it("returns defaults when no config file exists", async () => {
      const config = await loadConfig(tempDir);
      expect(config.indexModel).toBe(DEFAULT_INDEX_MODEL);
      expect(config.queryModel).toBe(DEFAULT_QUERY_MODEL);
    });

    it("reads config from .llm-kb/config.json", async () => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(tempDir, ".llm-kb"), { recursive: true });
      await writeFile(
        join(tempDir, ".llm-kb", "config.json"),
        JSON.stringify({ indexModel: "custom-haiku", queryModel: "custom-sonnet" })
      );

      const config = await loadConfig(tempDir);
      expect(config.indexModel).toBe("custom-haiku");
      expect(config.queryModel).toBe("custom-sonnet");
    });

    it("env vars override config file", async () => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(tempDir, ".llm-kb"), { recursive: true });
      await writeFile(
        join(tempDir, ".llm-kb", "config.json"),
        JSON.stringify({ indexModel: "from-file", queryModel: "from-file" })
      );

      process.env.LLM_KB_INDEX_MODEL = "from-env";
      process.env.LLM_KB_QUERY_MODEL = "from-env";

      try {
        const config = await loadConfig(tempDir);
        expect(config.indexModel).toBe("from-env");
        expect(config.queryModel).toBe("from-env");
      } finally {
        delete process.env.LLM_KB_INDEX_MODEL;
        delete process.env.LLM_KB_QUERY_MODEL;
      }
    });

    it("handles malformed config gracefully", async () => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(tempDir, ".llm-kb"), { recursive: true });
      await writeFile(join(tempDir, ".llm-kb", "config.json"), "not json{{{");

      const config = await loadConfig(tempDir);
      expect(config.indexModel).toBe(DEFAULT_INDEX_MODEL);
      expect(config.queryModel).toBe(DEFAULT_QUERY_MODEL);
    });
  });

  describe("ensureConfig", () => {
    it("creates config.json with defaults when none exists", async () => {
      const config = await ensureConfig(tempDir);
      expect(config.indexModel).toBe(DEFAULT_INDEX_MODEL);
      expect(config.queryModel).toBe(DEFAULT_QUERY_MODEL);

      const path = join(tempDir, ".llm-kb", "config.json");
      expect(existsSync(path)).toBe(true);

      const raw = JSON.parse(await readFile(path, "utf-8"));
      expect(raw.indexModel).toBe(DEFAULT_INDEX_MODEL);
    });

    it("does not overwrite existing config", async () => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(tempDir, ".llm-kb"), { recursive: true });
      await writeFile(
        join(tempDir, ".llm-kb", "config.json"),
        JSON.stringify({ indexModel: "my-model", queryModel: "my-model" })
      );

      const config = await ensureConfig(tempDir);
      expect(config.indexModel).toBe("my-model");
    });
  });
});
