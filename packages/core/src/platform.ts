import { join } from "node:path";
import { homedir } from "node:os";

export function getTraceDir(): string {
  return join(homedir(), ".opencode-trace");
}

export function sanitizePath(path: string, userHome: string): string {
  const escapedHome = userHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return path.replace(new RegExp(escapedHome, "g"), "[HOME]");
}