import { watch } from "chokidar";
import { extname, join, basename } from "node:path";
import { parsePDF } from "./pdf.js";
import { buildIndex } from "./indexer.js";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import chalk from "chalk";

interface WatcherOptions {
  folder: string;
  sourcesDir: string;
  debounceMs?: number;
  authStorage?: AuthStorage;
  indexModel?: string;
}

export function startWatcher({ folder, sourcesDir, debounceMs = 2000, authStorage, indexModel }: WatcherOptions) {
  let pendingFiles: string[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function processBatch() {
    const files = [...pendingFiles];
    pendingFiles = [];

    if (files.length === 0) return;

    console.log();
    for (const filePath of files) {
      const name = basename(filePath);
      process.stdout.write(`  Parsing ${name}...`);
      try {
        const result = await parsePDF(filePath, sourcesDir);
        if (result.skipped) {
          console.log(chalk.dim(` skipped (up to date)`));
        } else {
          console.log(chalk.green(` ✓ ${result.totalPages} pages`));
        }
      } catch (err: any) {
        console.log(chalk.red(` ✗ ${err.message}`));
      }
    }

    // Re-index
    process.stdout.write(`  Re-indexing...`);
    try {
      await buildIndex(folder, sourcesDir, undefined, authStorage, indexModel);
      console.log(chalk.green(` ✓ index.md updated`));
    } catch (err: any) {
      console.log(chalk.red(` ✗ ${err.message}`));
    }
  }

  function queueFile(filePath: string) {
    if (!pendingFiles.includes(filePath)) {
      pendingFiles.push(filePath);
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processBatch, debounceMs);
  }

  const watcher = watch(folder, {
    ignoreInitial: true,
    ignored: [
      "**/node_modules/**",
      "**/.llm-kb/**",
      "**/.git/**",
    ],
    depth: 10,
  });

  watcher.on("add", (filePath) => {
    const ext = extname(filePath).toLowerCase();
    if (ext === ".pdf") {
      console.log(chalk.dim(`\n  New file: ${basename(filePath)}`));
      queueFile(filePath);
    }
  });

  watcher.on("change", (filePath) => {
    const ext = extname(filePath).toLowerCase();
    if (ext === ".pdf") {
      console.log(chalk.dim(`\n  Changed: ${basename(filePath)}`));
      queueFile(filePath);
    }
  });

  return watcher;
}
