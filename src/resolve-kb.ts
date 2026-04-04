import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

/**
 * Walk up from startDir looking for a .llm-kb/ directory.
 * Returns the folder containing .llm-kb/, or null if not found.
 */
export function resolveKnowledgeBase(startDir: string): string | null {
  let dir = resolve(startDir);

  while (true) {
    if (existsSync(join(dir, ".llm-kb"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
