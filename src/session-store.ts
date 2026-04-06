import { SessionManager } from "@mariozechner/pi-coding-agent";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Create a file-based SessionManager for a KB folder.
 * Sessions are stored under .llm-kb/sessions/ so they act as
 * an automatic transaction log for all agent activity.
 */
export async function createKBSession(kbRoot: string): Promise<SessionManager> {
  const sessionDir = join(kbRoot, ".llm-kb", "sessions");
  await mkdir(sessionDir, { recursive: true });
  return SessionManager.create(kbRoot, sessionDir);
}
