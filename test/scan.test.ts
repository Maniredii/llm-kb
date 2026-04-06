import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scan, summarize } from "../src/scan.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("scan", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "llm-kb-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("finds supported files", async () => {
    await writeFile(join(tempDir, "doc.pdf"), "");
    await writeFile(join(tempDir, "data.xlsx"), "");
    await writeFile(join(tempDir, "notes.md"), "");
    await writeFile(join(tempDir, "ignore.exe"), "");

    const files = await scan(tempDir);
    expect(files.length).toBe(3);
    expect(files.map((f) => f.ext).sort()).toEqual([".md", ".pdf", ".xlsx"]);
  });

  it("skips .llm-kb internal directory", async () => {
    await mkdir(join(tempDir, ".llm-kb"), { recursive: true });
    await writeFile(join(tempDir, ".llm-kb", "index.md"), "");
    await writeFile(join(tempDir, "real.pdf"), "");

    const files = await scan(tempDir);
    expect(files.length).toBe(1);
    expect(files[0].name).toBe("real.pdf");
  });

  it("returns empty for empty directory", async () => {
    const files = await scan(tempDir);
    expect(files.length).toBe(0);
  });

  it("scans subdirectories", async () => {
    await mkdir(join(tempDir, "sub"), { recursive: true });
    await writeFile(join(tempDir, "sub", "nested.pdf"), "");

    const files = await scan(tempDir);
    expect(files.length).toBe(1);
    expect(files[0].path).toContain("sub");
  });
});

describe("summarize", () => {
  it("summarizes file counts by extension", () => {
    const files = [
      { name: "a.pdf", path: "a.pdf", ext: ".pdf" },
      { name: "b.pdf", path: "b.pdf", ext: ".pdf" },
      { name: "c.xlsx", path: "c.xlsx", ext: ".xlsx" },
    ];
    const result = summarize(files);
    expect(result).toContain("2 PDF");
    expect(result).toContain("1 XLSX");
  });
});
