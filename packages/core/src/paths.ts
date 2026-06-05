import path from "node:path";
import { homedir } from "node:os";

export function getTraceDir(): string {
  const pathApi = process.platform === "win32" ? path.win32 : path.posix;
  return pathApi.join(homedir(), ".opencode-trace");
}

export function sanitizePath(fpath: string, userHome: string): string {
  const escapedHome = userHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return fpath.replace(new RegExp(escapedHome, "g"), "[HOME]");
}
