import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Find the node_modules directory for llm-kb's bundled libraries.
 * Walks up from the current file to locate the nearest node_modules.
 */
export function getNodeModulesPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "node_modules");
    try { return candidate; } catch { dir = dirname(dir); }
  }
  return join(process.cwd(), "node_modules");
}
