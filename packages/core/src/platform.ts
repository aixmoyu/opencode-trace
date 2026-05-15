import { join, win32, posix } from "node:path";
import { homedir } from "node:os";

export function getTraceDir(): string {
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? homedir();
    return win32.join(base, process.env.APPDATA ? "opencode-trace" : ".opencode-trace");
  }
  return posix.join(homedir(), ".opencode-trace");
}

export function sanitizePath(path: string, userHome: string): string {
  const escapedHome = userHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return path.replace(new RegExp(escapedHome, "g"), "[HOME]");
}